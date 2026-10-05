export type AccessPerson = { externalId: string; name: string };
export type AccessSourceRef = { id: string; marketId: string; name: string };

/** The reader is down or too slow: keep the old list and try again later. */
export class AccessUnavailable extends Error {
  constructor(message = "access reader unavailable") {
    super(message);
    this.name = "AccessUnavailable";
  }
}

export interface AccessProvider {
  name: string;
  /** Everyone the reader currently has registered. The Market77 never receives faces, only ids and names. */
  listPeople(source: AccessSourceRef): Promise<AccessPerson[]>;
}
