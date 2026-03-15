/*
  # Add storage_path to documents_admin_history

  1. Changes
    - Add `storage_path` column to `documents_admin_history` table
    - Column stores the internal storage path for reliable signed URL generation
    - Allows fallback when public URLs don't work (e.g., private buckets)

  2. Notes
    - Nullable to maintain backward compatibility with existing rows
    - New documents will populate both pdf_url and storage_path
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents_admin_history' AND column_name = 'storage_path'
  ) THEN
    ALTER TABLE documents_admin_history ADD COLUMN storage_path text;
    CREATE INDEX IF NOT EXISTS idx_documents_admin_history_storage_path ON documents_admin_history(storage_path);
  END IF;
END $$;
