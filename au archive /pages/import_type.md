- objective
	- classify if import file is image, video, map file, urls, or document
-
- steps
	- is file an image
	  logseq.order-list-type:: number
		- check #json_img
		  logseq.order-list-type:: number
		- if image record in #auarchive
		  logseq.order-list-type:: number
			- #imgnamo
			  logseq.order-list-type:: number
			- #imgloco
			  logseq.order-list-type:: number
		- if not image continue
		  logseq.order-list-type:: number
	- is file a video
	  logseq.order-list-type:: number
		- check #json_vid
		  logseq.order-list-type:: number
		- if video record in #auarchive
		  logseq.order-list-type:: number
			- #vidnamo
			  logseq.order-list-type:: number
			- #vidloco
			  logseq.order-list-type:: number
		- if not video continue
		  logseq.order-list-type:: number
	- is file a map
	  logseq.order-list-type:: number
		- check #json_map
		  logseq.order-list-type:: number
		- if map record in #auarchive
		  logseq.order-list-type:: number
			- #mapnamo
			  logseq.order-list-type:: number
			- #maploco
			  logseq.order-list-type:: number
		- if not map continue
		  logseq.order-list-type:: number
	- is file a map
	  logseq.order-list-type:: number
		- record in #auarchive
		  logseq.order-list-type:: number
			- #docnamo
			  logseq.order-list-type:: number
			- #docloco
			  logseq.order-list-type:: number