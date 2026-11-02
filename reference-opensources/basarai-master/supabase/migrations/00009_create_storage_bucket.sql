-- ========================================
-- Storage Bucket Setup
-- ========================================

-- Insert the brand-assets bucket (public, 5MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  true,
  5242880, -- 5MB in bytes
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml'
  ]
) ON CONFLICT (id) DO NOTHING;

-- ========================================
-- Storage RLS Policies
-- ========================================

-- Public read policy: Anyone can read from brand-assets bucket
CREATE POLICY "Public Read" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'brand-assets');

-- Insert policy: Authenticated users can insert into their brand folders
CREATE POLICY "Authenticated Insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'brand-assets' AND
    auth.uid() = (
      SELECT owner_user_id
      FROM brands
      WHERE id = (storage.foldername(name))[2]::UUID
    )
  );

-- Update policy: Authenticated users can update files in their brand folders
CREATE POLICY "Authenticated Update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'brand-assets' AND
    auth.uid() = (
      SELECT owner_user_id
      FROM brands
      WHERE id = (storage.foldername(name))[2]::UUID
    )
  )
  WITH CHECK (
    bucket_id = 'brand-assets' AND
    auth.uid() = (
      SELECT owner_user_id
      FROM brands
      WHERE id = (storage.foldername(name))[2]::UUID
    )
  );

-- Delete policy: Authenticated users can delete files in their brand folders
CREATE POLICY "Authenticated Delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'brand-assets' AND
    auth.uid() = (
      SELECT owner_user_id
      FROM brands
      WHERE id = (storage.foldername(name))[2]::UUID
    )
  );
