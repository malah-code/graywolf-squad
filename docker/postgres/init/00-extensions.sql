-- ==============================================================================
-- Graywolf Squad — PostgreSQL Initial Extensions
-- Enables vector embeddings (pgvector) and envelope encryption (pgcrypto)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
