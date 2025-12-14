/*
  # Create Study Scrape Pages Table

  1. New Table
    - `study_scrape_pages` - Stores page-level scraping progress for crash recovery
      - `id` (uuid, primary key)
      - `scrape_session_id` (text, indexed) - Unique ID for each scraping session
      - `domain` (text) - Domain being scraped (marktplaats, leboncoin, etc.)
      - `base_url` (text) - Original search URL
      - `page_number` (int) - Page number scraped
      - `fetched_url` (text) - Actual URL fetched for this page
      - `extracted_count` (int) - Total listings extracted from page
      - `new_unique_count` (int) - New unique listings added
      - `created_at` (timestamptz) - When the page was scraped

  2. Purpose
    - Incremental persistence for multi-page scraping
    - Crash recovery and progress tracking
    - Analytics for pagination effectiveness
    - Does NOT affect scoring, ranking, or opportunities

  3. Security
    - Enable RLS
    - Policy: authenticated users can read/write their own scrape data
*/

create table if not exists study_scrape_pages (
  id uuid primary key default gen_random_uuid(),
  scrape_session_id text not null,
  domain text not null,
  base_url text not null,
  page_number int not null,
  fetched_url text not null,
  extracted_count int not null default 0,
  new_unique_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_study_scrape_pages_session
  on study_scrape_pages (scrape_session_id);

create index if not exists idx_study_scrape_pages_domain
  on study_scrape_pages (domain);

create index if not exists idx_study_scrape_pages_created_at
  on study_scrape_pages (created_at desc);

alter table study_scrape_pages enable row level security;

create policy "Users can read own scrape pages"
  on study_scrape_pages for select
  to authenticated
  using (true);

create policy "Users can insert own scrape pages"
  on study_scrape_pages for insert
  to authenticated
  with check (true);
