#!/bin/bash
# AU Archive Database Seeder (Shell Script)
# Seeds the database with test locations and sets the archive_folder.
#
# Usage:
#   ./scripts/seed-database.sh                    # Show status
#   ./scripts/seed-database.sh --archive <path>   # Set archive folder
#   ./scripts/seed-database.sh --seed             # Seed 20 test locations
#   ./scripts/seed-database.sh --clear            # Clear existing data
#   ./scripts/seed-database.sh --all <path>       # Do everything

DB_PATH="$HOME/Library/Application Support/@au-archive/desktop/data/au-archive.db"

echo "AU Archive Database CLI Tool"
echo "============================"
echo "Database path: $DB_PATH"
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "ERROR: Database does not exist. Run the app first to initialize."
    exit 1
fi

# ADR-046: Generate BLAKE3-like 16-char hex ID (for locid)
generate_blake3_id() {
    openssl rand -hex 8
}

# Generate UUID (for user_id and other entity IDs)
generate_uuid() {
    python3 -c "import uuid; print(str(uuid.uuid4()))"
}

# Function to generate loc12
generate_loc12() {
    name=$1
    slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-' | head -c 6)
    random=$(openssl rand -hex 3)
    echo "${slug}-${random}"
}

# Function to show status
show_status() {
    echo "Database Status:"
    echo "-----------------"
    echo ""
    echo "Settings:"
    sqlite3 "$DB_PATH" "SELECT '  ' || key || ': ' || value FROM settings;"
    echo ""
    echo "Record Counts:"
    sqlite3 "$DB_PATH" "SELECT '  Locations: ' || COUNT(*) FROM locs;"
    sqlite3 "$DB_PATH" "SELECT '  Images: ' || COUNT(*) FROM imgs;"
    sqlite3 "$DB_PATH" "SELECT '  Videos: ' || COUNT(*) FROM vids;"
    sqlite3 "$DB_PATH" "SELECT '  Documents: ' || COUNT(*) FROM docs;"
    sqlite3 "$DB_PATH" "SELECT '  Users: ' || COUNT(*) FROM users;"
}

# Function to clear data
clear_data() {
    echo "Clearing existing data..."
    sqlite3 "$DB_PATH" <<EOF
DELETE FROM imgs;
DELETE FROM vids;
DELETE FROM docs;
DELETE FROM maps;
DELETE FROM notes;
DELETE FROM slocs;
DELETE FROM project_locations;
DELETE FROM projects;
DELETE FROM imports;
DELETE FROM bookmarks;
DELETE FROM locs;
EOF
    echo "Data cleared."
}

# Function to set archive folder
set_archive_folder() {
    folder=$1
    echo "Setting archive_folder to: $folder"

    # Create folder if it doesn't exist
    if [ ! -d "$folder" ]; then
        echo "Creating archive folder: $folder"
        mkdir -p "$folder"
    fi

    sqlite3 "$DB_PATH" "INSERT INTO settings (key, value) VALUES ('archive_folder', '$folder') ON CONFLICT(key) DO UPDATE SET value = excluded.value;"
    echo "archive_folder setting saved."
}

# Function to seed locations
seed_locations() {
    echo "Seeding test locations..."
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Array of locations - name|type|stype|city|county|state|zip|lat|lng|condition|status|access
    locations=(
        "Grossinger's Catskill Resort|Resort|Hotel|Liberty|Sullivan|NY|12754|41.8012|-74.7468|demolished|demolished|none"
        "Eastern State Penitentiary|Prison|Correctional Facility|Philadelphia|Philadelphia|PA|19130|39.9683|-75.1727|stabilized|museum|public"
        "Greystone Park Psychiatric Hospital|Hospital|Psychiatric|Parsippany|Morris|NJ|07054|40.8442|-74.4175|demolished|demolished|none"
        "Buffalo Central Terminal|Transportation|Train Station|Buffalo|Erie|NY|14211|42.8831|-78.8175|restoring|restoration|limited"
        "Kings Park Psychiatric Center|Hospital|Psychiatric|Kings Park|Suffolk|NY|11754|40.8854|-73.2456|abandoned|abandoned|restricted"
        "Letchworth Village|Hospital|Developmental Center|Thiells|Rockland|NY|10984|41.2109|-74.0673|deteriorating|abandoned|restricted"
        "Pilgrim State Hospital|Hospital|Psychiatric|Brentwood|Suffolk|NY|11717|40.7736|-73.2562|partial|partial_use|restricted"
        "Bethlehem Steel|Industrial|Steel Mill|Lackawanna|Erie|NY|14218|42.8167|-78.8333|demolished|demolished|none"
        "Hudson River State Hospital|Hospital|Psychiatric|Poughkeepsie|Dutchess|NY|12601|41.7081|-73.9075|deteriorating|redevelopment|restricted"
        "Willard Asylum|Hospital|Psychiatric|Willard|Seneca|NY|14588|42.6845|-76.8684|partial|partial_use|restricted"
        "Rochester Subway|Transportation|Subway|Rochester|Monroe|NY|14604|43.1566|-77.6088|abandoned|abandoned|restricted"
        "Carousel Mall|Commercial|Shopping Mall|Syracuse|Onondaga|NY|13290|43.0667|-76.1667|operational|operational|public"
        "Harlem Valley Psychiatric Center|Hospital|Psychiatric|Wingdale|Dutchess|NY|12594|41.6364|-73.5447|demolished|demolished|none"
        "Fort Totten|Military|Fort|Bayside|Queens|NY|11359|40.7928|-73.7750|preserved|park|public"
        "North Brother Island|Hospital|Quarantine|Bronx|Bronx|NY|10474|40.8011|-73.9000|deteriorating|abandoned|restricted"
        "Bannerman Castle|Military|Arsenal|Beacon|Dutchess|NY|12508|41.4533|-73.9867|ruins|historic_site|limited"
        "Utica State Hospital|Hospital|Psychiatric|Utica|Oneida|NY|13502|43.1009|-75.2327|partial|mixed_use|limited"
        "Ellis Island Hospital|Hospital|Immigration|Jersey City|Hudson|NJ|07305|40.6992|-74.0392|stabilized|tours|limited"
        "Borscht Belt Hotels Ruins|Resort|Hotel|Monticello|Sullivan|NY|12701|41.6556|-74.6900|ruins|abandoned|restricted"
        "Central Islip State Hospital|Hospital|Psychiatric|Central Islip|Suffolk|NY|11722|40.7912|-73.2012|demolished|redeveloped|public"
    )

    count=0
    for loc in "${locations[@]}"; do
        IFS='|' read -r name type stype city county state zip lat lng condition status access <<< "$loc"

        LOCID=$(generate_blake3_id)
        LOC12=$(generate_loc12 "$name")
        SLOCNAM=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-' | head -c 20)

        # Escape single quotes for SQL
        name_escaped="${name//\'/\'\'}"
        sqlite3 "$DB_PATH" "INSERT INTO locs (locid, loc12, locnam, slocnam, type, stype, address_city, address_county, address_state, address_zipcode, gps_lat, gps_lng, gps_source, gps_verified_on_map, condition, status, access, locadd, locup, auth_imp) VALUES ('$LOCID', '$LOC12', '$name_escaped', '$SLOCNAM', '$type', '$stype', '$city', '$county', '$state', '$zip', $lat, $lng, 'manual_entry', 0, '$condition', '$status', '$access', '$NOW', '$NOW', 'seed-script');"

        echo "  Added: $name"
        count=$((count + 1))
    done

    echo ""
    echo "Seeded $count locations."
}

# Function to ensure default user exists
ensure_default_user() {
    user_count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users;")
    if [ "$user_count" -eq 0 ]; then
        echo "Creating default user..."
        USER_ID=$(generate_uuid)
        NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        sqlite3 "$DB_PATH" "INSERT INTO users (user_id, username, display_name, created_date) VALUES ('$USER_ID', 'default', 'Default User', '$NOW');"
    fi

    # Ensure current_user setting exists
    current_user=$(sqlite3 "$DB_PATH" "SELECT value FROM settings WHERE key = 'current_user';")
    if [ -z "$current_user" ]; then
        echo "Setting current_user to default..."
        sqlite3 "$DB_PATH" "INSERT INTO settings (key, value) VALUES ('current_user', 'default') ON CONFLICT(key) DO UPDATE SET value = excluded.value;"
    fi
}

# Parse arguments
case "$1" in
    --status|-s)
        show_status
        ;;
    --clear|-c)
        clear_data
        show_status
        ;;
    --archive|-a)
        if [ -z "$2" ]; then
            echo "ERROR: Please provide a path for the archive folder"
            echo "Usage: $0 --archive /path/to/archive"
            exit 1
        fi
        set_archive_folder "$2"
        ensure_default_user
        show_status
        ;;
    --seed)
        seed_locations
        ensure_default_user
        show_status
        ;;
    --all)
        if [ -z "$2" ]; then
            echo "ERROR: Please provide a path for the archive folder"
            echo "Usage: $0 --all /path/to/archive"
            exit 1
        fi
        clear_data
        set_archive_folder "$2"
        seed_locations
        ensure_default_user
        echo ""
        show_status
        ;;
    --help|-h)
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --status, -s              Show database status"
        echo "  --archive, -a <path>      Set the archive folder path"
        echo "  --seed                    Seed 20 test locations"
        echo "  --clear, -c               Clear existing data"
        echo "  --all <path>              Clear, set archive, and seed locations"
        echo "  --help, -h                Show this help message"
        echo ""
        show_status
        ;;
    *)
        show_status
        ;;
esac
