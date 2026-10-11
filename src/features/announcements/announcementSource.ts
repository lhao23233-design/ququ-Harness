export interface ModelAnnouncement {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  sourceName: string;
}

export interface AnnouncementSource {
  readonly id: string;
  fetchLatest(): Promise<ModelAnnouncement[]>;
}
