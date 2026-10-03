import { createNewsletterQueries } from './queries';
import {
  newsletterDetail,
  newsletterEquivalenceReviews,
  newsletterEvidenceDetails,
  newsletterGet,
  newsletterHistory,
} from '../server';
export const newsletterQueries = createNewsletterQueries({
  newsletterGet,
  newsletterHistory,
  newsletterDetail,
  newsletterEvidenceDetails,
  newsletterEquivalenceReviews,
});
