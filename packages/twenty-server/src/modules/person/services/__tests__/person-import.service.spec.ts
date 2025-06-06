import { Test, TestingModule } from '@nestjs/testing';

import { TwentyORMGlobalManager } from 'src/engine/twenty-orm/twenty-orm-global.manager';
import { CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { PersonWorkspaceEntity } from '../../standard-objects/person.workspace-entity';
import { PersonImportService } from '../person-import.service';

describe('PersonImportService', () => {
  let service: PersonImportService;
  let mockTwentyORMGlobalManager: jest.Mocked<TwentyORMGlobalManager>;
  let mockCompanyRepository;
  let mockPersonRepository;

  beforeEach(async () => {
    mockCompanyRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      manager: {
        save: jest.fn(),
      },
    };

    mockPersonRepository = {
      manager: {
        save: jest.fn(),
      },
    };

    mockTwentyORMGlobalManager = {
      getRepositoryForWorkspace: jest.fn().mockImplementation((workspaceId, entity) => {
        if (entity === CompanyWorkspaceEntity) {
          return Promise.resolve(mockCompanyRepository);
        }
        if (entity === PersonWorkspaceEntity) {
          return Promise.resolve(mockPersonRepository);
        }
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonImportService,
        {
          provide: TwentyORMGlobalManager,
          useValue: mockTwentyORMGlobalManager,
        },
      ],
    }).compile();

    service = module.get<PersonImportService>(PersonImportService);
  });

  describe('importPeopleFromCSV', () => {
    const workspaceId = 'test-workspace-id';
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    const mockCompany = {
      id: validUUID,
      name: 'Test Company',
      domainName: { primaryLinkUrl: 'test.com' },
    };

    //Teste de Importação com UUID

    it('should successfully import people with valid company UUID', async () => {
      const csvData = [{
        nameFirstName: 'John',
        nameLastName: 'Doe',
        emailsPrimaryEmail: 'john@test.com',
        company: validUUID,
      }];

      mockCompanyRepository.findOne.mockResolvedValueOnce(mockCompany);
      mockPersonRepository.manager.save.mockResolvedValueOnce([{
        id: 'new-person-id',
        name: { firstName: 'John', lastName: 'Doe' },
      }]);

      const result = await service.importPeopleFromCSV(csvData, workspaceId);

      expect(result.success).toBe(true);
      expect(result.createdPeople).toHaveLength(1);
      expect(result.companyMappingResults[0].resolved).toBe(true);
      expect(result.companyMappingResults[0].matchedBy).toBe('uuid');
    });

    //Teste de Fallback para Nome

    it('should handle company mapping by name when UUID not found', async () => {
      const csvData = [{
        nameFirstName: 'Jane',
        nameLastName: 'Smith',
        emailsPrimaryEmail: 'jane@test.com',
        company: 'Test Company',
      }];

      mockCompanyRepository.findOne
        .mockResolvedValueOnce(null) // UUID search fails
        .mockResolvedValueOnce(mockCompany); // Name search succeeds

      const result = await service.importPeopleFromCSV(csvData, workspaceId);

      expect(result.success).toBe(true);
      expect(result.companyMappingResults[0].resolved).toBe(true);
      expect(result.companyMappingResults[0].matchedBy).toBe('name');
    });

    //Teste do sistema de sugestões

    it('should suggest similar companies when no exact match found', async () => {
      const csvData = [{
        nameFirstName: 'Alice',
        nameLastName: 'Johnson',
        emailsPrimaryEmail: 'alice@test.com',
        company: 'Test Corp',
      }];

      mockCompanyRepository.findOne.mockResolvedValue(null);
      mockCompanyRepository.find.mockResolvedValueOnce([
        { id: 'company-1', name: 'Test Corporation', domainName: { primaryLinkUrl: 'testcorp.com' } },
        { id: 'company-2', name: 'Test Company', domainName: { primaryLinkUrl: 'test.com' } },
      ]);

      const result = await service.importPeopleFromCSV(csvData, workspaceId);

      expect(result.success).toBe(true);
      expect(result.companyMappingResults[0].resolved).toBe(false);
      expect(result.companyMappingResults[0].suggestedCompanies).toHaveLength(2);
    });

    //teste de casos esoeciais - dados incompletos
    it('should handle import with missing company information', async () => {
      const csvData = [{
        nameFirstName: 'Bob',
        nameLastName: 'Wilson',
        emailsPrimaryEmail: 'bob@test.com',
      }];

      const result = await service.importPeopleFromCSV(csvData, workspaceId);

      expect(result.success).toBe(true);
      expect(result.companyMappingResults).toHaveLength(0);
    });

    //tratamento de erros

    it('should handle errors during import', async () => {
      const csvData = [{
        nameFirstName: 'Error',
        nameLastName: 'Test',
        emailsPrimaryEmail: 'error@test.com',
        company: 'Error Company',
      }];

      mockCompanyRepository.findOne.mockRejectedValue(new Error('Database error'));

      const result = await service.importPeopleFromCSV(csvData, workspaceId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validateCompanyMappings', () => {
    const workspaceId = 'test-workspace-id';
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';

    //
    it('should validate company mappings correctly', async () => {
      const companies = [validUUID, 'Test Company', 'Unknown Company'];
      const mockCompany = {
        id: validUUID,
        name: 'Test Company',
      };

      mockCompanyRepository.findOne
        .mockResolvedValueOnce(mockCompany) // UUID search
        .mockResolvedValueOnce(mockCompany) // Name search
        .mockResolvedValueOnce(null); // Unknown company

      mockCompanyRepository.find.mockResolvedValueOnce([
        { id: 'suggestion-1', name: 'Similar Company' },
      ]);

      const result = await service.validateCompanyMappings(companies, workspaceId);

      expect(result).toHaveLength(3);
      expect(result[0].resolved).toBe(true);
      expect(result[0].matchedBy).toBe('uuid');
      expect(result[1].resolved).toBe(true);
      expect(result[1].matchedBy).toBe('name');
      expect(result[2].resolved).toBe(false);
      expect(result[2].suggestedCompanies).toBeDefined();
    });
  });
}); 