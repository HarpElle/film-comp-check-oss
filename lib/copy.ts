/** Landing copy, used verbatim. Do not edit wording here without new copy. */
export const COPY = {
  title: "Film Comp Check",
  purpose: "Check whether each film on your comp slide belongs there.",
  sub: "For producers checking a comp slide before it goes to investors.",
  button: "Try the Pennywell sample",
  /** Who-pays block, locked 2026-10-27, verbatim. */
  whoPays: "Film funds ask for comps. Telefilm Canada wants the performance of comparable films in production financing applications, and the New Zealand Film Commission wants comparative titles with their box office. Filmmakers already pay for comps built on box office, such as $599 for 10 films from FilmProposals or $299 for a FILM.FUND Comparable Film Report. Those tools measure money. Film Comp Check uses Qloo taste data to test whether a deck's comps fit together and draw a similar audience, and flags any comp that doesn't.",
  differs: "Other tools help you find or build comps. This checks the comps you already picked.",
  limits: "It doesn't predict box office, and it doesn't catch a same-genre hit added to make a deck look bigger.",
} as const;

/** The landing's two lines: the who-pays block, then how it differs. */
export const FOLDED: readonly string[] = [COPY.whoPays, `How it differs: ${COPY.differs}`];
