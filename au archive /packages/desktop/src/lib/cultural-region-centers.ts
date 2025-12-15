/**
 * Cultural Region Center Points
 *
 * Maps each cultural region (state:region format) to its approximate geographic center.
 * Centers are based on well-known cities, landmarks, and geographic features.
 * Used for map centering and visualization.
 */

export const CULTURAL_REGION_CENTERS: Record<string, { lat: number; lng: number }> = {
  // NEW YORK
  'NY:Adirondacks': { lat: 43.9, lng: -74.3 }, // Lake Placid area
  'NY:Capital Region': { lat: 42.6526, lng: -73.7562 }, // Albany
  'NY:Catskills': { lat: 42.1, lng: -74.4 }, // Tannersville area
  'NY:Central NY': { lat: 43.0481, lng: -76.1474 }, // Syracuse
  'NY:Finger Lakes': { lat: 42.8679, lng: -76.9764 }, // Seneca Falls area
  'NY:Hudson Valley': { lat: 41.5, lng: -73.9 }, // Poughkeepsie area
  'NY:Long Island': { lat: 40.8, lng: -73.2 }, // Central Long Island
  'NY:Mohawk Valley': { lat: 43.0, lng: -75.0 }, // Utica area
  'NY:North Country': { lat: 44.4, lng: -75.2 }, // Watertown area
  'NY:NYC Metro': { lat: 40.7128, lng: -74.0060 }, // New York City
  'NY:Southern Tier': { lat: 42.1, lng: -76.8 }, // Binghamton area
  'NY:Thousand Islands': { lat: 44.3, lng: -75.9 }, // Clayton area
  'NY:Western NY': { lat: 42.8864, lng: -78.8784 }, // Buffalo

  // PENNSYLVANIA
  'PA:Capital Region': { lat: 40.2732, lng: -76.8867 }, // Harrisburg
  'PA:Central PA': { lat: 40.85, lng: -77.8 }, // State College area
  'PA:Coal Region': { lat: 40.8, lng: -76.2 }, // Pottsville area
  'PA:Dutch Country': { lat: 40.0379, lng: -76.3055 }, // Lancaster
  'PA:Endless Mountains': { lat: 41.7, lng: -76.3 }, // Towanda area
  'PA:Lake Erie Region': { lat: 42.1, lng: -80.1 }, // Erie
  'PA:Laurel Highlands': { lat: 40.0, lng: -79.3 }, // Uniontown area
  'PA:Lehigh Valley': { lat: 40.6, lng: -75.4 }, // Allentown-Bethlehem
  'PA:PA Wilds': { lat: 41.4, lng: -77.8 }, // North-central PA
  'PA:Philadelphia Metro': { lat: 39.9526, lng: -75.1652 }, // Philadelphia
  'PA:Pittsburgh Metro': { lat: 40.4406, lng: -79.9959 }, // Pittsburgh
  'PA:Poconos': { lat: 41.1, lng: -75.3 }, // Mount Pocono area
  'PA:Susquehanna Valley': { lat: 40.3, lng: -76.6 }, // York-Lancaster area

  // NEW JERSEY
  'NJ:Delaware River Region': { lat: 40.2, lng: -75.0 }, // Trenton area
  'NJ:Gateway Region': { lat: 40.7, lng: -74.2 }, // Newark-Jersey City
  'NJ:Greater Atlantic City': { lat: 39.3643, lng: -74.4229 }, // Atlantic City
  'NJ:Jersey Shore': { lat: 40.0, lng: -74.0 }, // Asbury Park-Toms River
  'NJ:Pine Barrens': { lat: 39.8, lng: -74.5 }, // Central Pine Barrens
  'NJ:Skylands': { lat: 41.0, lng: -74.7 }, // Northwest NJ

  // CONNECTICUT
  'CT:Connecticut River Valley': { lat: 41.7, lng: -72.6 }, // Hartford-Middletown corridor
  'CT:Gold Coast': { lat: 41.1, lng: -73.4 }, // Stamford-Greenwich
  'CT:Greater Hartford': { lat: 41.7658, lng: -72.6734 }, // Hartford
  'CT:Greater New Haven': { lat: 41.3083, lng: -72.9279 }, // New Haven
  'CT:Litchfield Hills': { lat: 41.9, lng: -73.3 }, // Northwest CT
  'CT:Quiet Corner': { lat: 41.85, lng: -72.0 }, // Northeast CT

  // MASSACHUSETTS
  'MA:Berkshires': { lat: 42.4, lng: -73.2 }, // Pittsfield area
  'MA:Cape Cod': { lat: 41.7, lng: -70.0 }, // Mid-Cape
  'MA:Central MA': { lat: 42.2626, lng: -71.8023 }, // Worcester
  'MA:Greater Boston': { lat: 42.3601, lng: -71.0589 }, // Boston
  'MA:North Shore': { lat: 42.5, lng: -70.9 }, // Salem-Gloucester
  'MA:Pioneer Valley': { lat: 42.1, lng: -72.6 }, // Springfield-Northampton
  'MA:South Shore': { lat: 42.0, lng: -70.7 }, // Quincy-Plymouth

  // RHODE ISLAND
  'RI:Blackstone Valley': { lat: 42.0, lng: -71.5 }, // Woonsocket area
  'RI:Greater Providence': { lat: 41.8240, lng: -71.4128 }, // Providence
  'RI:Newport County': { lat: 41.5, lng: -71.3 }, // Newport-Middletown
  'RI:South County': { lat: 41.4, lng: -71.6 }, // South Kingstown area

  // VERMONT
  'VT:Champlain Valley': { lat: 44.5, lng: -73.2 }, // Burlington area
  'VT:Green Mountains': { lat: 43.6, lng: -72.8 }, // Central VT spine
  'VT:Northeast Kingdom': { lat: 44.6, lng: -72.0 }, // St. Johnsbury area
  'VT:Southern Vermont': { lat: 43.1, lng: -72.8 }, // Brattleboro-Bennington

  // NEW HAMPSHIRE
  'NH:Great North Woods': { lat: 44.8, lng: -71.3 }, // Colebrook area
  'NH:Lakes Region': { lat: 43.6, lng: -71.4 }, // Laconia-Meredith
  'NH:Monadnock Region': { lat: 42.9, lng: -72.1 }, // Keene area
  'NH:Seacoast': { lat: 43.0, lng: -70.8 }, // Portsmouth area
  'NH:Southern NH': { lat: 42.9, lng: -71.5 }, // Manchester-Nashua
  'NH:White Mountains': { lat: 44.2, lng: -71.3 }, // North Conway area

  // MAINE
  'ME:Aroostook County': { lat: 46.7, lng: -68.0 }, // Caribou-Presque Isle
  'ME:Central Maine': { lat: 44.5, lng: -69.6 }, // Waterville area
  'ME:Down East': { lat: 44.6, lng: -67.6 }, // Machias-Calais
  'ME:Greater Portland': { lat: 43.6591, lng: -70.2568 }, // Portland
  'ME:Midcoast': { lat: 44.1, lng: -69.1 }, // Camden-Rockland
  'ME:Southern Maine': { lat: 43.4, lng: -70.6 }, // Saco-Biddeford
  'ME:Western Mountains': { lat: 44.8, lng: -70.6 }, // Rangeley-Bethel

  // MARYLAND
  'MD:Baltimore Metro': { lat: 39.2904, lng: -76.6122 }, // Baltimore
  'MD:Capital Region': { lat: 38.9, lng: -77.0 }, // Montgomery-PG Counties
  'MD:Eastern Shore': { lat: 38.7, lng: -75.9 }, // Easton-Salisbury
  'MD:Southern Maryland': { lat: 38.4, lng: -76.7 }, // Charles-Calvert-St. Mary's
  'MD:Western Maryland': { lat: 39.5, lng: -78.8 }, // Cumberland-Garrett County

  // VIRGINIA
  'VA:Blue Ridge': { lat: 38.1, lng: -79.0 }, // Charlottesville-Waynesboro
  'VA:Hampton Roads': { lat: 36.9, lng: -76.3 }, // Norfolk-Virginia Beach
  'VA:Northern Virginia': { lat: 38.9, lng: -77.3 }, // Arlington-Fairfax
  'VA:Piedmont': { lat: 37.3, lng: -78.8 }, // Lynchburg-Danville
  'VA:Richmond Metro': { lat: 37.5407, lng: -77.4360 }, // Richmond
  'VA:Shenandoah Valley': { lat: 38.4, lng: -78.8 }, // Winchester-Harrisonburg
  'VA:Southwest Virginia': { lat: 36.8, lng: -81.2 }, // Roanoke-Blacksburg

  // WEST VIRGINIA
  'WV:Eastern Panhandle': { lat: 39.4, lng: -77.9 }, // Martinsburg area
  'WV:Metro Valley': { lat: 38.3, lng: -81.6 }, // Charleston-Huntington
  'WV:Mountain State': { lat: 38.8, lng: -80.4 }, // Central WV
  'WV:Northern Panhandle': { lat: 40.1, lng: -80.6 }, // Wheeling area
  'WV:Potomac Highlands': { lat: 39.0, lng: -79.5 }, // Elkins-Petersburg

  // OHIO
  'OH:Appalachian Ohio': { lat: 39.3, lng: -82.1 }, // Athens-Hocking Hills
  'OH:Central Ohio': { lat: 39.9612, lng: -82.9988 }, // Columbus
  'OH:Lake Erie Region': { lat: 41.5, lng: -82.7 }, // Sandusky area
  'OH:Northeast Ohio': { lat: 41.4993, lng: -81.6944 }, // Cleveland-Akron
  'OH:Northwest Ohio': { lat: 41.6528, lng: -83.5379 }, // Toledo area
  'OH:Southeast Ohio': { lat: 40.0, lng: -81.5 }, // Zanesville-Cambridge
  'OH:Southwest Ohio': { lat: 39.1031, lng: -84.5120 }, // Cincinnati-Dayton

  // MICHIGAN
  'MI:Metro Detroit': { lat: 42.3314, lng: -83.0458 }, // Detroit
  'MI:Mid-Michigan': { lat: 43.6, lng: -84.3 }, // Saginaw-Bay City-Midland
  'MI:Northern Michigan': { lat: 44.8, lng: -85.5 }, // Traverse City-Petoskey
  'MI:Southwest Michigan': { lat: 42.2, lng: -86.0 }, // Kalamazoo-St. Joseph
  'MI:Thumb Region': { lat: 43.5, lng: -82.8 }, // Port Huron-Bad Axe
  'MI:Upper Peninsula': { lat: 46.5, lng: -87.4 }, // Marquette area
  'MI:West Michigan': { lat: 43.0, lng: -85.7 }, // Grand Rapids-Muskegon

  // DELAWARE
  'DE:Central Delaware': { lat: 39.1, lng: -75.5 }, // Dover area
  'DE:Northern Delaware': { lat: 39.7, lng: -75.6 }, // Wilmington-Newark
  'DE:Southern Delaware': { lat: 38.6, lng: -75.2 }, // Sussex County beaches

  // FLORIDA
  'FL:Central Florida': { lat: 28.5, lng: -81.4 }, // Orlando-Lakeland
  'FL:Florida Keys': { lat: 24.7, lng: -81.0 }, // Key West-Marathon
  'FL:North Florida': { lat: 30.3, lng: -82.6 }, // Gainesville-Ocala
  'FL:Panhandle': { lat: 30.4, lng: -85.8 }, // Panama City-Destin
  'FL:Southeast Florida': { lat: 26.1, lng: -80.3 }, // Fort Lauderdale-Miami
  'FL:Southwest Florida': { lat: 26.6, lng: -81.9 }, // Fort Myers-Naples
  'FL:Space Coast': { lat: 28.3, lng: -80.7 }, // Cocoa Beach-Titusville
  'FL:Tampa Bay': { lat: 27.9, lng: -82.5 }, // Tampa-St. Petersburg
  'FL:Treasure Coast': { lat: 27.4, lng: -80.3 }, // Vero Beach-Port St. Lucie

  // GEORGIA
  'GA:Augusta Area': { lat: 33.4735, lng: -82.0105 }, // Augusta
  'GA:Central Georgia': { lat: 32.8407, lng: -83.6324 }, // Macon
  'GA:Coastal Georgia': { lat: 31.5, lng: -81.3 }, // Savannah-Brunswick
  'GA:Metro Atlanta': { lat: 33.7490, lng: -84.3880 }, // Atlanta
  'GA:North Georgia Mountains': { lat: 34.7, lng: -83.9 }, // Dahlonega-Blue Ridge
  'GA:Southeast Georgia': { lat: 31.2, lng: -82.3 }, // Valdosta-Waycross
  'GA:Southwest Georgia': { lat: 31.5, lng: -84.2 }, // Albany-Columbus

  // NORTH CAROLINA
  'NC:Charlotte Metro': { lat: 35.2271, lng: -80.8431 }, // Charlotte
  'NC:Coastal Plain': { lat: 35.5, lng: -77.8 }, // Greenville-Rocky Mount
  'NC:Mountains': { lat: 35.6, lng: -82.5 }, // Asheville-Boone
  'NC:Outer Banks': { lat: 35.6, lng: -75.5 }, // Nags Head-Hatteras
  'NC:Piedmont Triad': { lat: 36.0, lng: -79.8 }, // Greensboro-Winston-Salem
  'NC:Sandhills': { lat: 35.2, lng: -79.4 }, // Pinehurst-Southern Pines
  'NC:Triangle': { lat: 35.8, lng: -78.7 }, // Raleigh-Durham-Chapel Hill

  // SOUTH CAROLINA
  'SC:Grand Strand': { lat: 33.7, lng: -78.9 }, // Myrtle Beach area
  'SC:Lowcountry': { lat: 32.8, lng: -80.0 }, // Charleston-Hilton Head
  'SC:Midlands': { lat: 34.0, lng: -81.0 }, // Columbia
  'SC:Pee Dee': { lat: 34.2, lng: -79.8 }, // Florence-Darlington
  'SC:Upstate': { lat: 34.9, lng: -82.4 }, // Greenville-Spartanburg

  // ALABAMA
  'AL:Birmingham Metro': { lat: 33.5186, lng: -86.8104 }, // Birmingham
  'AL:Black Belt': { lat: 32.4, lng: -87.5 }, // Selma-Demopolis
  'AL:Central Alabama': { lat: 32.3668, lng: -86.2999 }, // Montgomery
  'AL:Gulf Coast': { lat: 30.7, lng: -88.0 }, // Mobile-Gulf Shores
  'AL:North Alabama': { lat: 34.7, lng: -86.6 }, // Huntsville-Florence
  'AL:Wiregrass': { lat: 31.2, lng: -85.4 }, // Dothan area

  // KENTUCKY
  'KY:Bluegrass': { lat: 38.0, lng: -84.5 }, // Lexington area
  'KY:Eastern Kentucky': { lat: 37.3, lng: -82.8 }, // Pikeville-Hazard
  'KY:Louisville Metro': { lat: 38.2527, lng: -85.7585 }, // Louisville
  'KY:Northern Kentucky': { lat: 39.0, lng: -84.5 }, // Covington-Florence
  'KY:South Central Kentucky': { lat: 37.0, lng: -86.0 }, // Bowling Green area
  'KY:Western Kentucky': { lat: 37.0, lng: -88.6 }, // Paducah-Owensboro

  // MISSISSIPPI
  'MS:Capital Region': { lat: 32.2988, lng: -90.1848 }, // Jackson
  'MS:Delta': { lat: 33.6, lng: -90.7 }, // Clarksdale-Greenville
  'MS:Gulf Coast': { lat: 30.4, lng: -89.0 }, // Biloxi-Gulfport
  'MS:Hill Country': { lat: 34.3, lng: -89.0 }, // Oxford-Tupelo
  'MS:Pine Belt': { lat: 31.3, lng: -89.3 }, // Hattiesburg-Laurel

  // TENNESSEE
  'TN:Cumberland Plateau': { lat: 36.0, lng: -85.0 }, // Cookeville-Crossville
  'TN:East Tennessee': { lat: 35.9, lng: -83.9 }, // Knoxville area
  'TN:Memphis Metro': { lat: 35.1495, lng: -90.0490 }, // Memphis
  'TN:Middle Tennessee': { lat: 35.6, lng: -86.3 }, // Murfreesboro area
  'TN:Nashville Metro': { lat: 36.1627, lng: -86.7816 }, // Nashville
  'TN:West Tennessee': { lat: 35.7, lng: -88.8 }, // Jackson-Dyersburg

  // ARKANSAS
  'AR:Central Arkansas': { lat: 34.7465, lng: -92.2896 }, // Little Rock
  'AR:Delta': { lat: 34.5, lng: -91.0 }, // Eastern AR lowlands
  'AR:Northwest Arkansas': { lat: 36.3, lng: -94.2 }, // Fayetteville-Bentonville
  'AR:Ozarks': { lat: 36.4, lng: -92.4 }, // Mountain Home area
  'AR:Timberlands': { lat: 33.6, lng: -92.7 }, // South AR

  // LOUISIANA
  'LA:Acadiana': { lat: 30.2, lng: -92.0 }, // Lafayette-Lake Charles
  'LA:Capital Region': { lat: 30.4515, lng: -91.1871 }, // Baton Rouge
  'LA:Crossroads': { lat: 31.3, lng: -92.4 }, // Alexandria-Pineville
  'LA:Greater New Orleans': { lat: 29.9511, lng: -90.0715 }, // New Orleans
  'LA:North Louisiana': { lat: 32.5, lng: -92.1 }, // Monroe-Shreveport
  'LA:River Parishes': { lat: 30.0, lng: -90.6 }, // West bank parishes

  // OKLAHOMA
  'OK:Green Country': { lat: 36.2, lng: -95.9 }, // Tulsa area
  'OK:Northwest Oklahoma': { lat: 36.7, lng: -98.4 }, // Enid-Woodward
  'OK:Oklahoma City Metro': { lat: 35.4676, lng: -97.5164 }, // Oklahoma City
  'OK:Southeast Oklahoma': { lat: 34.6, lng: -95.4 }, // Durant-McAlester
  'OK:Southwest Oklahoma': { lat: 34.6, lng: -98.4 }, // Lawton area

  // TEXAS
  'TX:Austin Metro': { lat: 30.2672, lng: -97.7431 }, // Austin
  'TX:Central Texas': { lat: 31.1, lng: -97.3 }, // Waco-Temple-Killeen
  'TX:Coastal Bend': { lat: 27.8, lng: -97.4 }, // Corpus Christi area
  'TX:Dallas-Fort Worth': { lat: 32.8, lng: -97.0 }, // DFW Metroplex
  'TX:East Texas': { lat: 32.3, lng: -94.7 }, // Tyler-Longview
  'TX:Hill Country': { lat: 30.0, lng: -99.2 }, // Fredericksburg-Kerrville
  'TX:Houston Metro': { lat: 29.7604, lng: -95.3698 }, // Houston
  'TX:Panhandle': { lat: 35.2, lng: -101.8 }, // Amarillo-Lubbock
  'TX:Rio Grande Valley': { lat: 26.2, lng: -98.2 }, // McAllen-Brownsville
  'TX:San Antonio Metro': { lat: 29.4241, lng: -98.4936 }, // San Antonio
  'TX:South Texas': { lat: 27.5, lng: -99.5 }, // Laredo area
  'TX:West Texas': { lat: 31.8, lng: -102.4 }, // Midland-Odessa-El Paso

  // ILLINOIS
  'IL:Central Illinois': { lat: 40.1, lng: -89.4 }, // Bloomington-Peoria
  'IL:Chicagoland': { lat: 41.8781, lng: -87.6298 }, // Chicago
  'IL:Collar Counties': { lat: 41.8, lng: -88.3 }, // DuPage-Kane-Lake
  'IL:Metro East': { lat: 38.6, lng: -90.0 }, // East St. Louis area
  'IL:Northern Illinois': { lat: 42.3, lng: -89.1 }, // Rockford area
  'IL:Southern Illinois': { lat: 37.7, lng: -89.2 }, // Carbondale-Marion

  // INDIANA
  'IN:Central Indiana': { lat: 39.7684, lng: -86.1581 }, // Indianapolis
  'IN:East Central Indiana': { lat: 40.2, lng: -85.4 }, // Muncie-Anderson
  'IN:Northeast Indiana': { lat: 41.1, lng: -85.1 }, // Fort Wayne
  'IN:Northwest Indiana': { lat: 41.5, lng: -87.3 }, // Gary-Hammond region
  'IN:Southern Indiana': { lat: 38.3, lng: -86.1 }, // Evansville-Bloomington
  'IN:West Central Indiana': { lat: 40.4, lng: -87.0 }, // Lafayette-Terre Haute

  // WISCONSIN
  'WI:Central Wisconsin': { lat: 44.4, lng: -89.7 }, // Stevens Point-Marshfield
  'WI:Door County Peninsula': { lat: 45.1, lng: -87.3 }, // Sturgeon Bay area
  'WI:Driftless Area': { lat: 43.4, lng: -90.7 }, // La Crosse-Viroqua
  'WI:Fox Valley': { lat: 44.3, lng: -88.4 }, // Appleton-Oshkosh
  'WI:Milwaukee Metro': { lat: 43.0389, lng: -87.9065 }, // Milwaukee
  'WI:Northwoods': { lat: 45.8, lng: -89.6 }, // Rhinelander-Eagle River

  // IOWA
  'IA:Central Iowa': { lat: 42.0, lng: -93.5 }, // Ames-Fort Dodge
  'IA:Des Moines Metro': { lat: 41.5868, lng: -93.6250 }, // Des Moines
  'IA:Eastern Iowa': { lat: 41.8, lng: -91.2 }, // Cedar Rapids-Iowa City
  'IA:Northern Iowa': { lat: 43.0, lng: -92.5 }, // Waterloo-Mason City
  'IA:Western Iowa': { lat: 41.3, lng: -95.9 }, // Sioux City-Council Bluffs

  // KANSAS
  'KS:Flint Hills': { lat: 38.5, lng: -96.5 }, // Manhattan-Emporia
  'KS:Kansas City Metro': { lat: 39.1, lng: -94.6 }, // KCK-Johnson County
  'KS:Northeast Kansas': { lat: 39.0, lng: -95.7 }, // Lawrence-Topeka
  'KS:Southeast Kansas': { lat: 37.5, lng: -95.0 }, // Pittsburg-Chanute
  'KS:Western Kansas': { lat: 38.9, lng: -100.0 }, // Dodge City-Hays

  // MINNESOTA
  'MN:Boundary Waters': { lat: 48.0, lng: -91.0 }, // Ely-Grand Marais
  'MN:Central Minnesota': { lat: 45.6, lng: -94.2 }, // St. Cloud area
  'MN:Iron Range': { lat: 47.5, lng: -92.5 }, // Hibbing-Virginia
  'MN:Northwest Minnesota': { lat: 47.9, lng: -96.8 }, // Crookston-Thief River Falls
  'MN:Southern Minnesota': { lat: 44.0, lng: -94.0 }, // Mankato-Rochester
  'MN:Twin Cities Metro': { lat: 44.9778, lng: -93.2650 }, // Minneapolis-St. Paul

  // MISSOURI
  'MO:Bootheel': { lat: 36.6, lng: -89.8 }, // Southeast MO
  'MO:Central Missouri': { lat: 38.5, lng: -92.2 }, // Columbia-Jefferson City
  'MO:Kansas City Metro': { lat: 39.0997, lng: -94.5786 }, // Kansas City
  'MO:Northern Missouri': { lat: 40.2, lng: -93.0 }, // Kirksville-Macon
  'MO:Ozarks': { lat: 37.2, lng: -93.3 }, // Springfield-Branson
  'MO:St. Louis Metro': { lat: 38.6270, lng: -90.1994 }, // St. Louis

  // NEBRASKA
  'NE:Lincoln Metro': { lat: 40.8136, lng: -96.7026 }, // Lincoln
  'NE:Omaha Metro': { lat: 41.2565, lng: -95.9345 }, // Omaha
  'NE:Panhandle': { lat: 41.9, lng: -103.7 }, // Scottsbluff-Gering
  'NE:Sandhills': { lat: 42.3, lng: -101.0 }, // Valentine-Broken Bow

  // NORTH DAKOTA
  'ND:Badlands': { lat: 46.9, lng: -103.5 }, // Medora-Dickinson
  'ND:Lake Region': { lat: 47.9, lng: -99.0 }, // Devils Lake area
  'ND:Missouri Slope': { lat: 46.8, lng: -100.8 }, // Bismarck-Mandan
  'ND:Red River Valley': { lat: 46.9, lng: -97.0 }, // Fargo-Grand Forks

  // SOUTH DAKOTA
  'SD:Black Hills': { lat: 44.0, lng: -103.5 }, // Rapid City-Deadwood
  'SD:Missouri River': { lat: 44.4, lng: -100.3 }, // Pierre area
  'SD:Northeast': { lat: 45.5, lng: -97.5 }, // Watertown-Aberdeen
  'SD:West River': { lat: 43.5, lng: -101.5 }, // West of Missouri River

  // ARIZONA
  'AZ:Northern Arizona': { lat: 35.2, lng: -111.7 }, // Flagstaff-Sedona
  'AZ:Phoenix Metro': { lat: 33.4484, lng: -112.0740 }, // Phoenix
  'AZ:Southeastern Arizona': { lat: 31.7, lng: -110.0 }, // Tucson-Bisbee
  'AZ:Tucson Metro': { lat: 32.2226, lng: -110.9747 }, // Tucson
  'AZ:Western Arizona': { lat: 34.5, lng: -114.3 }, // Lake Havasu-Yuma

  // COLORADO
  'CO:Eastern Plains': { lat: 40.0, lng: -103.5 }, // Sterling-Lamar
  'CO:Front Range': { lat: 39.7, lng: -105.0 }, // Denver-Fort Collins-Pueblo
  'CO:Mountain Corridor': { lat: 39.6, lng: -106.4 }, // Summit-Eagle-Vail
  'CO:Northwest Colorado': { lat: 40.5, lng: -107.5 }, // Steamboat-Craig
  'CO:San Luis Valley': { lat: 37.6, lng: -105.9 }, // Alamosa area
  'CO:Western Slope': { lat: 39.1, lng: -108.5 }, // Grand Junction-Montrose

  // IDAHO
  'ID:Boise Metro': { lat: 43.6150, lng: -116.2023 }, // Boise-Meridian
  'ID:Central Idaho': { lat: 44.3, lng: -115.0 }, // Salmon-Stanley
  'ID:Eastern Idaho': { lat: 43.5, lng: -112.0 }, // Idaho Falls-Pocatello
  'ID:Magic Valley': { lat: 42.6, lng: -114.5 }, // Twin Falls area
  'ID:Panhandle': { lat: 47.7, lng: -116.8 }, // Coeur d'Alene-Sandpoint

  // MONTANA
  'MT:Central Montana': { lat: 47.0, lng: -109.5 }, // Lewistown area
  'MT:Eastern Montana': { lat: 46.4, lng: -105.8 }, // Miles City-Glendive
  'MT:Hi-Line': { lat: 48.5, lng: -110.7 }, // Havre-Glasgow
  'MT:Southwest Montana': { lat: 45.7, lng: -111.0 }, // Bozeman-Butte-Helena
  'MT:Western Montana': { lat: 46.9, lng: -114.0 }, // Missoula-Kalispell

  // NEVADA
  'NV:Cowboy Country': { lat: 40.8, lng: -117.0 }, // Elko-Winnemucca
  'NV:Las Vegas Metro': { lat: 36.1699, lng: -115.1398 }, // Las Vegas
  'NV:Reno-Tahoe': { lat: 39.5, lng: -119.8 }, // Reno-Carson City
  'NV:Rural Nevada': { lat: 38.8, lng: -117.2 }, // Central NV

  // NEW MEXICO
  'NM:Albuquerque Metro': { lat: 35.0844, lng: -106.6504 }, // Albuquerque
  'NM:Northern New Mexico': { lat: 36.4, lng: -105.9 }, // Taos-Española
  'NM:Northwest New Mexico': { lat: 36.0, lng: -108.2 }, // Farmington-Gallup
  'NM:Santa Fe Area': { lat: 35.6870, lng: -105.9378 }, // Santa Fe
  'NM:Southern New Mexico': { lat: 32.3, lng: -106.8 }, // Las Cruces-Roswell

  // UTAH
  'UT:Central Utah': { lat: 39.3, lng: -111.7 }, // Price-Castle Country
  'UT:Eastern Utah': { lat: 38.6, lng: -109.5 }, // Moab-Vernal
  'UT:Northern Utah': { lat: 41.2, lng: -111.9 }, // Logan-Brigham City
  'UT:Southern Utah': { lat: 37.7, lng: -113.1 }, // St. George-Cedar City
  'UT:Wasatch Front': { lat: 40.7, lng: -111.9 }, // Salt Lake-Provo-Ogden

  // WYOMING
  'WY:Northeast Wyoming': { lat: 44.8, lng: -105.5 }, // Gillette-Sheridan
  'WY:Southeast Wyoming': { lat: 41.1, lng: -104.8 }, // Cheyenne-Laramie
  'WY:Southwest Wyoming': { lat: 41.6, lng: -109.3 }, // Rock Springs-Evanston
  'WY:Yellowstone Country': { lat: 44.4, lng: -110.6 }, // Cody-Jackson Hole

  // ALASKA
  'AK:Anchorage/Southcentral': { lat: 61.2181, lng: -149.9003 }, // Anchorage
  'AK:Arctic Alaska': { lat: 68.0, lng: -151.0 }, // North Slope-Arctic
  'AK:Fairbanks/Interior': { lat: 64.8378, lng: -147.7164 }, // Fairbanks
  'AK:Kodiak Island': { lat: 57.8, lng: -152.4 }, // Kodiak
  'AK:Southeast Alaska': { lat: 58.3, lng: -134.4 }, // Juneau-Ketchikan
  'AK:Southwest Alaska': { lat: 59.0, lng: -158.5 }, // Bethel-Dillingham

  // CALIFORNIA
  'CA:Bay Area': { lat: 37.7749, lng: -122.4194 }, // San Francisco-Oakland-San Jose
  'CA:Central Coast': { lat: 35.4, lng: -120.6 }, // San Luis Obispo-Monterey
  'CA:Central Valley': { lat: 36.7, lng: -119.8 }, // Fresno-Bakersfield-Modesto
  'CA:Eastern California': { lat: 36.6, lng: -118.0 }, // Sierra-Death Valley
  'CA:Far North': { lat: 40.6, lng: -122.4 }, // Redding-Chico
  'CA:Greater Los Angeles': { lat: 34.0522, lng: -118.2437 }, // Los Angeles metro
  'CA:Inland Empire': { lat: 34.1, lng: -117.3 }, // Riverside-San Bernardino
  'CA:North Coast': { lat: 39.7, lng: -123.8 }, // Eureka-Mendocino
  'CA:San Diego Metro': { lat: 32.7157, lng: -117.1611 }, // San Diego
  'CA:Sierra Nevada': { lat: 38.0, lng: -120.0 }, // Tahoe-Yosemite corridor

  // HAWAII
  'HI:Big Island': { lat: 19.6, lng: -155.5 }, // Hilo-Kona
  'HI:Kauai': { lat: 22.0, lng: -159.5 }, // Lihue area
  'HI:Maui County': { lat: 20.8, lng: -156.3 }, // Maui-Molokai-Lanai
  'HI:Neighbor Islands': { lat: 21.3, lng: -157.8 }, // All outer islands
  'HI:Oahu': { lat: 21.4389, lng: -158.0001 }, // Honolulu

  // OREGON
  'OR:Central Oregon': { lat: 44.1, lng: -121.3 }, // Bend-Redmond
  'OR:Eastern Oregon': { lat: 44.0, lng: -118.8 }, // Pendleton-Baker City
  'OR:Oregon Coast': { lat: 44.6, lng: -124.0 }, // Newport-Coos Bay
  'OR:Portland Metro': { lat: 45.5152, lng: -122.6784 }, // Portland
  'OR:Southern Oregon': { lat: 42.3, lng: -122.9 }, // Medford-Ashland-Klamath
  'OR:Willamette Valley': { lat: 44.3, lng: -123.1 }, // Eugene-Salem-Corvallis

  // WASHINGTON
  'WA:Central Washington': { lat: 46.7, lng: -120.5 }, // Yakima-Wenatchee
  'WA:Eastern Washington': { lat: 47.7, lng: -117.4 }, // Spokane-Tri-Cities
  'WA:North Central Washington': { lat: 48.5, lng: -120.3 }, // Okanogan-Methow
  'WA:Olympic Peninsula': { lat: 48.0, lng: -124.0 }, // Port Angeles-Forks
  'WA:Puget Sound': { lat: 47.6, lng: -122.3 }, // Seattle-Tacoma-Everett
  'WA:Southwest Washington': { lat: 46.0, lng: -122.9 }, // Vancouver-Longview

  // DISTRICT OF COLUMBIA
  'DC:Capitol Hill': { lat: 38.8899, lng: -76.9905 }, // US Capitol area
  'DC:Downtown DC': { lat: 38.9007, lng: -77.0228 }, // Downtown/Penn Quarter
  'DC:Georgetown': { lat: 38.9076, lng: -77.0723 }, // Georgetown
  'DC:Northeast DC': { lat: 38.9200, lng: -76.9800 }, // NE quadrant
  'DC:Northwest DC': { lat: 38.9400, lng: -77.0500 }, // NW quadrant
  'DC:Southeast DC': { lat: 38.8700, lng: -76.9800 }, // SE quadrant/Anacostia
  'DC:Southwest DC': { lat: 38.8800, lng: -77.0200 }, // SW quadrant/Waterfront

  // PUERTO RICO
  'PR:Central Mountains': { lat: 18.2000, lng: -66.4000 }, // Caguas-Cayey area
  'PR:East Coast': { lat: 18.3500, lng: -65.8000 }, // Fajardo-Humacao
  'PR:North Coast': { lat: 18.4500, lng: -66.7000 }, // Arecibo-Manatí
  'PR:San Juan Metro': { lat: 18.4655, lng: -66.1057 }, // San Juan
  'PR:South Coast': { lat: 18.0000, lng: -66.6000 }, // Ponce area
  'PR:West Coast': { lat: 18.2000, lng: -67.1500 }, // Mayagüez area

  // US VIRGIN ISLANDS
  'VI:St. Croix': { lat: 17.7290, lng: -64.7340 }, // Christiansted
  'VI:St. John': { lat: 18.3358, lng: -64.7281 }, // Cruz Bay
  'VI:St. Thomas': { lat: 18.3419, lng: -64.9307 }, // Charlotte Amalie

  // GUAM
  'GU:Central Guam': { lat: 13.4443, lng: 144.7937 }, // Hagåtña
  'GU:Northern Guam': { lat: 13.5200, lng: 144.8500 }, // Dededo
  'GU:Southern Guam': { lat: 13.3500, lng: 144.7000 }, // Agat-Umatac
};
