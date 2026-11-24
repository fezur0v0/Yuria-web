export const HOME_POLAROID_KEY = 'home_polaroid_url';

export function homePolaroidImage(custom: string, work?: string | null, album?: string | null, background?: string) {
  return custom || work || album || background || '';
}
