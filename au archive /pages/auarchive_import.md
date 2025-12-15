- purpose:
	- import script that manages all imports
-
- trigger
	- #import_form
	- #drag_drop
-
- script
	- auarchive_import.py
-
- steps (in order)
	- #import_location
	  logseq.order-list-type:: number
	- #import_id
	  logseq.order-list-type:: number
	- #import_folder
	  logseq.order-list-type:: number
	- #import_files
	  logseq.order-list-type:: number
	- #import_exiftool
	  logseq.order-list-type:: number
	- #import_ffmpeg
	  logseq.order-list-type:: number
	- #import_maps
	  logseq.order-list-type:: number
	- #import_gps
	  logseq.order-list-type:: number
	- #import_address
	  logseq.order-list-type:: number
	- #import_verify
	  logseq.order-list-type:: number
	- import_cleanup
	  logseq.order-list-type:: number
-