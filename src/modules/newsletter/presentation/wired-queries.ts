import { createNewsletterQueries } from './queries';
import {
  newsletterDetail,
  newsletterEquivalenceReviews,
  newsletterEvidenceDetails,
  newsletterGet,
  newsletterHistory,
  newsletterJobDetail,
} from '../server';
export const newsletterQueries = createNewsletterQueries({
  newsletterGet,
  newsletterHistory,
  newsletterDetail,
  newsletterEvidenceDetails,
  newsletterEquivalenceReviews,
  newsletterJobDetail,
});
