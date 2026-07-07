vi.mock("@calcom/lib/next-seo.config", () => ({
  default: {
    headSeo: {
      siteName: "Davnoot",
    },
    defaultNextSeo: {
      title: "Davnoot",
      description: "Scheduling infrastructure for everyone.",
    },
  },
  seoConfig: {
    headSeo: {
      siteName: "Davnoot",
    },
  },
  buildSeoMeta: vi.fn().mockReturnValue({}),
}));
