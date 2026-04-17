import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://jayalfredprufrock.github.io",
  base: "/handshake",
  integrations: [
    starlight({
      title: "Handshake",
      logo: {
        src: "./src/assets/handshake-logo.png",
        alt: "Handshake",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/jayalfredprufrock/handshake",
        },
      ],
      sidebar: [
        { label: "Quickstart", slug: "quickstart" },
        {
          label: "Core",
          items: [
            { label: "Contracts", slug: "core/contracts" },
            { label: "CRUD Contracts", slug: "core/crud-contracts" },
            { label: "Validation", slug: "core/validation" },
            { label: "Type Helpers", slug: "core/type-helpers" },
          ],
        },
        {
          label: "Server",
          items: [{ label: "Hono", slug: "server/hono" }],
        },
        {
          label: "Client",
          items: [{ label: "Fetch Client", slug: "client/fetch" }],
        },
        { label: "FAQ", slug: "faq" },
      ],
    }),
  ],
});
