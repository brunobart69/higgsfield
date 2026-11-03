export const CUSTOMER_TYPES = ["individual", "company"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const ID_DOCUMENT_TYPES = ["dni", "nie", "passport", "other"] as const;
export const CUSTOMER_DOC_TYPES = ["id_document", "driving_licence", "proof_of_address", "company_registry", "other"] as const;
export const CUSTOMERS_PAGE_SIZE = 25;
