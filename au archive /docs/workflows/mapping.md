# Mapping Workflow

## Stack

- **Leaflet** 1.9 for map rendering
- **Supercluster** for marker clustering
- **Tile providers**: OSM, ESRI, Carto

## Default Configuration

- **Default layer**: ESRI World Imagery (satellite)
- **Default center**: [42.6526, -73.7562] (Albany, NY)
- **Default zoom**: 7
- **Max zoom**: 19 (18 for some providers)

## Tile Layers

### Satellite (Default)
- Provider: ESRI World Imagery
- Max Zoom: 19
- Use case: Primary verification layer

### Street
- Provider: OpenStreetMap
- Max Zoom: 19
- Use case: Address/road context

### Topographic
- Provider: OpenTopoMap
- Max Zoom: 17
- Use case: Terrain context

## Clustering

Supercluster configuration:
- **Cluster radius**: 60 pixels
- **Max zoom for clustering**: 16
- **Min points to form cluster**: 2

## Marker Colors by GPS Confidence

- **Green** (#10b981) — Map-confirmed (verified)
- **Blue** (#3b82f6) — High (EXIF <10m)
- **Yellow/Amber** (#f59e0b) — Medium (reverse-geocode)
- **Red** (#ef4444) — Low (manual/estimate)
- **Gray** (#6b7280) — None (no GPS)

## Interactions

- **Click marker** → Show location popup with name, type, GPS confidence
- **Right-click map** → Add new location at coordinates
- **Shift + drag marker** → Move location (updates GPS to map-confirmed)
- **Zoom in/out** → Clusters expand/collapse
- **Pan** → Debounced to maintain 60fps

## Filter Logic

Atlas supports filtering by:
- **State** (dropdown)
- **Type** (dropdown)
- **GPS confidence** (multi-select)
- **Search** (text search on name, address)

Filters apply in real-time, updating visible markers.

## Performance Targets

- Map interactions near **60 fps** with clustering
- Query under **100 ms** for 10k locations (requires indexed columns)
- Clustering recalculates on zoom/pan (debounced)
