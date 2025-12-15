import type { Props } from "astro";
import IconMail from "@/assets/icons/IconMail.svg";
import IconInstagram from "@/assets/icons/IconInstagram.svg";
import IconTikTok from "@/assets/icons/IconTikTok.svg";
import IconYoutube from "@/assets/icons/IconYoutube.svg";
import IconFacebook from "@/assets/icons/IconFacebook.svg";
import IconWhatsapp from "@/assets/icons/IconWhatsapp.svg";
import IconBrandX from "@/assets/icons/IconBrandX.svg";
import IconTelegram from "@/assets/icons/IconTelegram.svg";
import IconPinterest from "@/assets/icons/IconPinterest.svg";
import { SITE } from "@/config";

interface Social {
  name: string;
  href: string;
  linkTitle: string;
  icon: (_props: Props) => Element;
}

export const SOCIALS: Social[] = [
  {
    name: "Instagram",
    href: "https://instagram.com/abandonedupstate",
    linkTitle: `${SITE.title} on Instagram`,
    icon: IconInstagram,
  },
  {
    name: "TikTok",
    href: "https://tiktok.com/@abandonedupstate",
    linkTitle: `${SITE.title} on TikTok`,
    icon: IconTikTok,
  },
  {
    name: "YouTube",
    href: "https://youtube.com/@abandonedupstate",
    linkTitle: `${SITE.title} on YouTube`,
    icon: IconYoutube,
  },
  {
    name: "Facebook",
    href: "https://facebook.com/abandonedupstateproject",
    linkTitle: `${SITE.title} on Facebook`,
    icon: IconFacebook,
  },
  {
    name: "Mail",
    href: "mailto:info@abandonedupstate.com",
    linkTitle: `Send an email to ${SITE.title}`,
    icon: IconMail,
  },
] as const;

export const SHARE_LINKS: Social[] = [
  {
    name: "WhatsApp",
    href: "https://wa.me/?text=",
    linkTitle: `Share this location via WhatsApp`,
    icon: IconWhatsapp,
  },
  {
    name: "Facebook",
    href: "https://www.facebook.com/sharer.php?u=",
    linkTitle: `Share this location on Facebook`,
    icon: IconFacebook,
  },
  {
    name: "X",
    href: "https://x.com/intent/post?url=",
    linkTitle: `Share this location on X`,
    icon: IconBrandX,
  },
  {
    name: "Telegram",
    href: "https://t.me/share/url?url=",
    linkTitle: `Share this location via Telegram`,
    icon: IconTelegram,
  },
  {
    name: "Pinterest",
    href: "https://pinterest.com/pin/create/button/?url=",
    linkTitle: `Share this location on Pinterest`,
    icon: IconPinterest,
  },
  {
    name: "Mail",
    href: "mailto:?subject=See%20this%20location&body=",
    linkTitle: `Share this location via email`,
    icon: IconMail,
  },
] as const;
