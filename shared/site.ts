// Settings shared by every site (home, learn and blog). Change the name, email or addresses here and they update everywhere.
export const SITE = {
  name: 'Chris Miller',
  email: 'learn@withchris.uk',
  description: 'Maths tuition for GCSE, A-level and admissions tests, online or in London. Plus a blog on maths, medical imaging and code.',
};

// withchris.uk isn't active in the new Cloudflare account yet, so the sites live on workers.dev for now.
// When the domain moves over: set this to true and add the custom domains to each wrangler.jsonc.
const DOMAIN_LIVE = false;

export const URLS = DOMAIN_LIVE
  ? { home: 'https://withchris.uk', learn: 'https://learn.withchris.uk', blog: 'https://blog.withchris.uk' }
  : {
      home: 'https://withchris-home.withchris.workers.dev',
      learn: 'https://withchris-learn.withchris.workers.dev',
      blog: 'https://withchris-blog.withchris.workers.dev',
    };
