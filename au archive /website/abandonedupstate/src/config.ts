export const SITE = {
  website: "https://abandonedupstate.com/", // replace this with your deployed domain
  author: "Abandoned Upstate",
  profile: "https://abandonedupstate.com/",
  desc: "Exploring abandoned places and forgotten history throughout upstate New York.",
  title: "Abandoned Upstate",
  ogImage: "abandonedupstate-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 5,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true, // show back button in post detail
  editPost: {
    enabled: false,
    text: "Edit page",
    url: "",
  },
  dynamicOgImage: true,
  dir: "ltr", // "rtl" | "auto"
  lang: "en", // html lang code. Set this empty and default will be "en"
  timezone: "America/New_York", // Default global timezone (IANA format) https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
} as const;
