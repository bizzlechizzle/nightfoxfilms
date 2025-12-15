-- AU Archive Database Schema
-- SQLite database for local-first abandoned location archive

-- Locations table (primary entity)
CREATE TABLE IF NOT EXISTS locs (
  -- Identity
  locid TEXT PRIMARY KEY,
  loc12 TEXT UNIQUE NOT NULL,

  -- Basic Info
  locnam TEXT NOT NULL,
  slocnam TEXT,
  akanam TEXT,

  -- Classification
  type TEXT,
  stype TEXT,

  -- GPS (Primary Source of Truth)
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  gps_source TEXT,
  gps_status TEXT,
  gps_verified_on_map INTEGER DEFAULT 0,
  gps_captured_at TEXT,
  gps_leaflet_data TEXT,

  -- Address (Secondary, Optional)
  address_street TEXT,
  address_city TEXT,
  address_county TEXT,
  address_state TEXT CHECK(length(address_state) = 2),
  address_zipcode TEXT,
  address_confidence TEXT,
  address_geocoded_at TEXT,

  -- Status
  condition TEXT,
  status TEXT,
  documentation TEXT,
  access TEXT,
  historic INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,

  -- Relationships
  sublocs TEXT,
  sub12 TEXT,

  -- Metadata
  locadd TEXT,
  locup TEXT,
  auth_imp TEXT,
  locloc TEXT,

  -- Regions
  regions TEXT,
  state TEXT
);

CREATE INDEX IF NOT EXISTS idx_locs_state ON locs(address_state);
CREATE INDEX IF NOT EXISTS idx_locs_type ON locs(type);
CREATE INDEX IF NOT EXISTS idx_locs_gps ON locs(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locs_loc12 ON locs(loc12);
CREATE INDEX IF NOT EXISTS idx_locs_favorite ON locs(favorite) WHERE favorite = 1;

-- Sub-Locations table
CREATE TABLE IF NOT EXISTS slocs (
  subid TEXT PRIMARY KEY,
  sub12 TEXT UNIQUE NOT NULL,
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,

  subnam TEXT NOT NULL,
  ssubname TEXT,

  UNIQUE(subnam, locid)
);

CREATE INDEX IF NOT EXISTS idx_slocs_locid ON slocs(locid);

-- Images table
CREATE TABLE IF NOT EXISTS imgs (
  imghash TEXT PRIMARY KEY,
  imgnam TEXT NOT NULL,
  imgnamo TEXT NOT NULL,
  imgloc TEXT NOT NULL,
  imgloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  imgadd TEXT,

  meta_exiftool TEXT,

  -- Extracted metadata (for quick access)
  meta_width INTEGER,
  meta_height INTEGER,
  meta_date_taken TEXT,
  meta_camera_make TEXT,
  meta_camera_model TEXT,
  meta_gps_lat REAL,
  meta_gps_lng REAL
);

CREATE INDEX IF NOT EXISTS idx_imgs_locid ON imgs(locid);
CREATE INDEX IF NOT EXISTS idx_imgs_subid ON imgs(subid);
CREATE INDEX IF NOT EXISTS idx_imgs_sha ON imgs(imghash);

-- Videos table
CREATE TABLE IF NOT EXISTS vids (
  vidhash TEXT PRIMARY KEY,
  vidnam TEXT NOT NULL,
  vidnamo TEXT NOT NULL,
  vidloc TEXT NOT NULL,
  vidloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  vidadd TEXT,

  meta_ffmpeg TEXT,
  meta_exiftool TEXT,

  -- Extracted metadata
  meta_duration REAL,
  meta_width INTEGER,
  meta_height INTEGER,
  meta_codec TEXT,
  meta_fps REAL,
  meta_date_taken TEXT,
  -- FIX 3.2: GPS from video metadata (dashcams, phones)
  meta_gps_lat REAL,
  meta_gps_lng REAL
);

CREATE INDEX IF NOT EXISTS idx_vids_locid ON vids(locid);
CREATE INDEX IF NOT EXISTS idx_vids_subid ON vids(subid);

-- Documents table
CREATE TABLE IF NOT EXISTS docs (
  dochash TEXT PRIMARY KEY,
  docnam TEXT NOT NULL,
  docnamo TEXT NOT NULL,
  docloc TEXT NOT NULL,
  docloco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  docadd TEXT,

  meta_exiftool TEXT,

  -- Document-specific metadata
  meta_page_count INTEGER,
  meta_author TEXT,
  meta_title TEXT
);

CREATE INDEX IF NOT EXISTS idx_docs_locid ON docs(locid);

-- Maps table (Historical Maps)
CREATE TABLE IF NOT EXISTS maps (
  maphash TEXT PRIMARY KEY,
  mapnam TEXT NOT NULL,
  mapnamo TEXT NOT NULL,
  maploc TEXT NOT NULL,
  maploco TEXT NOT NULL,

  locid TEXT REFERENCES locs(locid),
  subid TEXT REFERENCES slocs(subid),

  auth_imp TEXT,
  mapadd TEXT,

  meta_exiftool TEXT,
  meta_map TEXT,
  -- FIX 3.4: GPS from parsed GPX/KML files
  meta_gps_lat REAL,
  meta_gps_lng REAL,

  reference TEXT,
  map_states TEXT,
  map_verified INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_maps_locid ON maps(locid);

-- URLs table (bookmarks/links per location)
CREATE TABLE IF NOT EXISTS urls (
  urlid TEXT PRIMARY KEY,
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,

  url TEXT NOT NULL,
  url_title TEXT,
  url_description TEXT,
  url_type TEXT,

  auth_imp TEXT,
  urladd TEXT
);

CREATE INDEX IF NOT EXISTS idx_urls_locid ON urls(locid);
