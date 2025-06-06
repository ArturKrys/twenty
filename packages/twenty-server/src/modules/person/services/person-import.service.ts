import { ConnectedAccountProvider } from 'twenty-shared/types';

import { Injectable } from '@nestjs/common';
import { DeepPartial, EntityManager, ILike } from 'typeorm';
import { validate as validateUUID } from 'uuid';

import { FieldActorSource } from 'src/engine/metadata-modules/field-metadata/composite-types/actor.composite-type';
import { TwentyORMGlobalManager } from 'src/engine/twenty-orm/twenty-orm-global.manager';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { WorkspaceRepository } from '../../../engine/twenty-orm/repository/workspace.repository';
import { CompanyMapping, PersonCSVData, PersonImportResult } from '../interfaces/person-import.interface';
import { PersonWorkspaceEntity } from '../standard-objects/person.workspace-entity';

export interface EmailsMetadata {
  primaryEmail: string;
  additionalEmails: object | null;
}

export interface PhonesMetadata {
  primaryPhoneNumber: string;
  primaryPhoneCountryCode: string;
  primaryPhoneCallingCode: string;
  additionalPhones: object | null;
}

@Injectable()
export class PersonImportService {
  source: FieldActorSource = FieldActorSource.MANUAL;
  provider: ConnectedAccountProvider = ConnectedAccountProvider.GOOGLE;

  constructor(
    private readonly twentyORMGlobalManager: TwentyORMGlobalManager,
  ) {}

  private isValidUUID(str: string): boolean {
    return validateUUID(str);
  }

  async importPeopleFromCSV(
    csvData: PersonCSVData[],
    workspaceId: string,
    transactionManager?: EntityManager,
  ): Promise<PersonImportResult> {
    try {
      const companyRepository = await this.twentyORMGlobalManager.getRepositoryForWorkspace(
        workspaceId,
        CompanyWorkspaceEntity,
      );

      const personRepository = await this.twentyORMGlobalManager.getRepositoryForWorkspace(
        workspaceId,
        PersonWorkspaceEntity,
      );

      const companyIdentifiers = new Set(
        csvData
          .map((row) => row.company)
          .filter((company): company is string => !!company)
      );

      const companyMappings = new Map<string, CompanyMapping>();

      for (const identifier of companyIdentifiers) {
        const mapping: CompanyMapping = {
          providedIdentifier: identifier,
          resolved: false,
          matchedBy: null,
        };

        try {
          if (this.isValidUUID(identifier)) {
            const company = await companyRepository.findOne({
              where: { id: identifier },
            });

            if (company) {
              mapping.resolved = true;
              mapping.companyId = company.id;
              mapping.matchedBy = 'uuid';
            }
          }

          if (!mapping.resolved) {
            const company = await companyRepository.findOne({
              where: { name: identifier },
            });

            if (company) {
              mapping.resolved = true;
              mapping.companyId = company.id;
              mapping.matchedBy = 'name';
            } else {
              mapping.suggestedCompanies = await this.findSimilarCompanies(
                identifier,
                companyRepository,
              );
              mapping.errorMessage = 'Company not found. Similar companies are suggested.';
            }
          }
        } catch (error) {
          mapping.errorMessage = `Error processing company: ${error.message}`;
        }

        companyMappings.set(identifier, mapping);
      }

      const peopleToCreate: DeepPartial<PersonWorkspaceEntity>[] = csvData.map((row) => {
        const person: DeepPartial<PersonWorkspaceEntity> = {
          name: {
            firstName: row.nameFirstName || '',
            lastName: row.nameLastName || '',
          },
          emails: {
            primaryEmail: row.emailsPrimaryEmail || '',
            additionalEmails: null,
          } as EmailsMetadata,
          jobTitle: row.jobTitle,
          phones: {
            primaryPhoneNumber: row.phonesPrimaryPhoneNumber || '',
            primaryPhoneCountryCode: 'US',
            primaryPhoneCallingCode: '1',
            additionalPhones: null,
          } as PhonesMetadata,
          city: row.city,
          source: this.source,
          provider: this.provider,
        };

        if (row.company) {
          const mapping = companyMappings.get(row.company);
          if (mapping?.resolved) {
            person.companyId = mapping.companyId;
          }
        }

        return person;
      });

      const manager = transactionManager || personRepository.manager;
      const createdPeople = await manager.save(PersonWorkspaceEntity, peopleToCreate);

      return {
        success: true,
        createdPeople,
        companyMappingResults: Array.from(companyMappings.values()),
      };
    } catch (error) {
      return {
        success: false,
        createdPeople: [],
        companyMappingResults: [],
        error: `Import failed: ${error.message}`,
      };
    }
  }

  private async findSimilarCompanies(
    name: string,
    companyRepository: WorkspaceRepository<CompanyWorkspaceEntity>,
  ) {
    const companies = await companyRepository.find({
      where: { name: ILike(`%${name}%`) },
      take: 5,
    });

    return companies.map(company => ({
      id: company.id,
      name: company.name,
      domainName: company.domainName?.primaryLinkUrl,
    }));
  }

  async importPeople(
    people: Array<{
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    }>,
  ): Promise<DeepPartial<PersonWorkspaceEntity>[]> {
    const peopleToCreate = people.map((person) => ({
      source: this.source,
      provider: this.provider,
      firstName: person.firstName,
      lastName: person.lastName,
      emails: {
        primaryEmail: person.email,
        additionalEmails: null,
      } as EmailsMetadata,
      phones: {
        primaryPhoneNumber: person.phone,
        primaryPhoneCountryCode: 'US',
        primaryPhoneCallingCode: '1',
        additionalPhones: null,
      } as PhonesMetadata,
    }));

    return peopleToCreate;
  }

  async validateCompanyMappings(
    companies: string[],
    workspaceId: string,
  ): Promise<CompanyMapping[]> {
    const companyRepository = await this.twentyORMGlobalManager.getRepositoryForWorkspace(
      workspaceId,
      CompanyWorkspaceEntity,
    );

    const mappings: CompanyMapping[] = [];

    for (const identifier of companies) {
      const mapping: CompanyMapping = {
        providedIdentifier: identifier,
        resolved: false,
        matchedBy: null,
      };

      try {
        if (this.isValidUUID(identifier)) {
          // Try to find by UUID first
          const company = await companyRepository.findOne({
            where: { id: identifier },
          });

          if (company) {
            mapping.resolved = true;
            mapping.companyId = company.id;
            mapping.matchedBy = 'uuid';
          }
        }

        // If not found by UUID or not a UUID, try by name
        if (!mapping.resolved) {
          const company = await companyRepository.findOne({
            where: { name: identifier },
          });

          if (company) {
            mapping.resolved = true;
            mapping.companyId = company.id;
            mapping.matchedBy = 'name';
          } else {
            // If no exact match, find similar companies
            mapping.suggestedCompanies = await this.findSimilarCompanies(
              identifier,
              companyRepository,
            );
            mapping.errorMessage = 'Company not found. Similar companies are suggested.';
          }
        }
      } catch (error) {
        mapping.errorMessage = `Error processing company: ${error.message}`;
      }

      mappings.push(mapping);
    }

    return mappings;
  }

  async createPeopleFromImport(
    peopleToCreate: Array<{
      source: FieldActorSource;
      provider: ConnectedAccountProvider;
      firstName: string;
      lastName: string;
      emails: EmailsMetadata;
      phones: PhonesMetadata;
    }>
  ): Promise<DeepPartial<PersonWorkspaceEntity>[]> {
    return peopleToCreate.map((person) => ({
      name: {
        firstName: person.firstName,
        lastName: person.lastName,
      },
      emails: {
        primaryEmail: person.emails.primaryEmail,
        additionalEmails: person.emails.additionalEmails ?? {},
      },
      phones: {
        primaryPhoneNumber: person.phones.primaryPhoneNumber,
        primaryPhoneCountryCode: person.phones.primaryPhoneCountryCode,
        primaryPhoneCallingCode: person.phones.primaryPhoneCallingCode,
        additionalPhones: person.phones.additionalPhones ?? {},
      },
      source: person.source,
      provider: person.provider,
    }));
  }
} 