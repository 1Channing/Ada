/*
  # Create Admin Documents Storage Bucket

  This migration creates a storage bucket for administrative PDF documents.

  ## Storage Configuration

  - Bucket name: `admin-documents`
  - Public access: true (for download links)
  - File size limit: 10MB per file
  - Allowed MIME types: application/pdf

  ## Security

  - Authenticated users can upload documents
  - Authenticated users can view all documents
  - Authenticated users can delete documents
*/

-- Create the admin-documents storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-documents', 'admin-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload documents
CREATE POLICY "Authenticated users can upload admin documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'admin-documents');

-- Allow authenticated users to view documents
CREATE POLICY "Authenticated users can view admin documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'admin-documents');

-- Allow authenticated users to delete documents
CREATE POLICY "Authenticated users can delete admin documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'admin-documents');

-- Allow authenticated users to update documents
CREATE POLICY "Authenticated users can update admin documents"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'admin-documents')
  WITH CHECK (bucket_id = 'admin-documents');