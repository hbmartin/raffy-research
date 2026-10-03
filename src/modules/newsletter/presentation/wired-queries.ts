import { createNewsletterQueries } from './queries';
import { newsletterGet } from '../server';
export const newsletterQueries = createNewsletterQueries({ newsletterGet });
