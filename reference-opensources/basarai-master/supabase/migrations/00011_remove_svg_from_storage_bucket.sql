-- Remove SVG from allowed MIME types (security risk: embedded scripts, XML entity attacks)
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'brand-assets';
