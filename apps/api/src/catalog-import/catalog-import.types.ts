export type ImportTarget =
  | 'displayName'
  | 'summary'
  | 'description'
  | 'brandId'
  | 'manufacturerName'
  | 'originalPartNumber'
  | 'modification'
  | 'categoryId'
  | 'attribute';

export interface ImportColumnMapping {
  columnIndex: number;
  target: ImportTarget;
  attributeDefinitionId?: string;
  categoryId?: string;
}

export interface ImportReferenceMapping {
  target: 'brandId' | 'categoryId';
  sourceValue: string;
  targetId: string;
}

export interface ImportSheetMapping {
  sheetIndex: number;
  headerRowNumber: number;
  fixedCategoryId?: string;
  fixedBrandId?: string;
  columnMappings: ImportColumnMapping[];
  referenceMappings: ImportReferenceMapping[];
}

export interface ImportMappingRequest {
  expectedVersion: number;
  mappingSchemaVersion: 1;
  sheetMappings: ImportSheetMapping[];
}

export interface ImportRowDecisionRequest {
  expectedRowVersion: number;
  action: 'ACCEPT_CREATE' | 'ACCEPT_REVISION' | 'REJECT' | 'HOLD';
  expectedProductVersion?: number;
  expectedCurrentRevisionId?: string;
  reasonCode?:
    'DUPLICATE_REVIEWED' | 'SOURCE_INCOMPLETE' | 'DATA_CORRECTED' | 'OTHER';
}
