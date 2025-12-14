/*
  # Add Car Image URLs Field

  ## Overview
  This migration adds a field to store car image URLs from detail pages for PDF export functionality.

  ## Changes

  ### Column Additions
  1. `study_source_listings.car_image_urls` (jsonb, nullable)
     - Array of car image URLs extracted from the listing detail page
     - Only contains real vehicle photos from the main gallery (no ads, logos, or site UI)
     - Default: empty JSON array []
     - Limited to first 8 images for performance

  ## Notes
  - These URLs will be used for PDF generation
  - Images are extracted marketplace-specifically (Leboncoin, Marktplaats, Bilbasen)
  - Filters out advertisement and promotional images
*/

-- Add car_image_urls column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'study_source_listings' AND column_name = 'car_image_urls'
  ) THEN
    ALTER TABLE study_source_listings ADD COLUMN car_image_urls jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
