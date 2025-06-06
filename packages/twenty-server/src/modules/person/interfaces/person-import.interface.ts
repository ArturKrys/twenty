export interface PersonCSVData {
  nameFirstName?: string;
  nameLastName?: string;
  emailsPrimaryEmail?: string;
  company?: string;
  jobTitle?: string;
  phonesPrimaryPhoneNumber?: string;
  city?: string;
}

export interface CompanyMapping {
  providedIdentifier: string;
  resolved: boolean;
  companyId?: string;
  matchedBy?: 'uuid' | 'name' | null;
  suggestedCompanies?: Array<{
    id: string;
    name: string;
    domainName?: string;
  }>;
  errorMessage?: string;
}

export interface PersonImportResult {
  success: boolean;
  createdPeople: any[];
  companyMappingResults: CompanyMapping[];
  error?: string;
} 