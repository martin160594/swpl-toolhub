/* ============================================================
   SWPL ToolHub - site configuration
   Edited by admin.html (Publish writes this file back to the
   repo, or download it and commit manually). Plain JS so the
   site also works over file:// with no fetch/CORS issues.
   ============================================================ */
window.SWPL_CONFIG = {
  "version": 2,
  "site": {
    "title": "SWPL ToolHub",
    "tagline": "Every SWPL tool in one launchpad. Open the web tools right here, grab the desktop apps when you need them.",
    "description": "SWPL ToolHub - the launchpad for SWPL web tools and desktop apps.",
    "logoText": "SWPL",
    "logoAccent": "ToolHub",
    "footerText": "SWPL internal tooling",
    "showHero": true,
    "showSearch": true,
    "showCategories": true,
    "showFooter": true,
    "showAdminLink": false
  },
  "theme": {
    "defaultMode": "system",
    "accentPreset": "ember",
    "accentCustom": "#c2410c",
    "radius": 14,
    "font": "grotesk",
    "density": "comfortable",
    "cardStyle": "elevated",
    "heroStyle": "aurora",
    "bgPattern": true,
    "animations": true,
    "customCSS": ""
  },
  "layout": {
    "columns": "auto",
    "groupByCategory": false,
    "showTags": true,
    "showBadges": true,
    "showVersions": true,
    "sort": "manual"
  },
  "categories": [
    { "id": "web", "name": "Web tools", "icon": "browser" },
    { "id": "desktop", "name": "Desktop apps", "icon": "desktop" }
  ],
  "github": {
    "owner": "martin160594",
    "repo": "swpl-toolhub",
    "branch": "main"
  },
  "security": {
    "passHash": "ced5b26c6de435f8760c80e9ba29db61254596a1fa23d392da32b7f6b923874a"
  }
};
