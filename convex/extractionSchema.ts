export const extractCompaniesSchema = {
  name: 'extract_companies',
  description: 'Extract consumer startups mentioned in the newsletter',
  parameters: {
    type: 'object',
    properties: {
      companies: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'one_line_summary', 'source_snippets', 'source_email_ids', 'confidence'],
          properties: {
            name: { type: 'string' },
            homepage_url: { type: 'string' },
            alt_domains: { type: 'array', items: { type: 'string' } },
            one_line_summary: { type: 'string', maxLength: 140 },
            category: {
              type: 'string',
              enum: [
                'Consumer AI',
                'Fintech',
                'Commerce',
                'Health',
                'Social',
                'Creator Tools',
                'Marketplaces',
                'Productivity',
                'Gaming',
                'Hardware',
                'Other'
              ]
            },
            stage: { type: 'string', enum: ['pre-seed', 'seed', 'A', 'B', 'unknown'] },
            location: { type: 'string' },
            key_signals: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['waitlist', 'launch', 'funding', 'traction', 'notable_founder', 'partnership']
              }
            },
            source_email_ids: { type: 'array', items: { type: 'string' } },
            source_snippets: {
              type: 'array',
              minItems: 1,
              maxItems: 2,
              items: {
                type: 'object',
                required: ['quote'],
                properties: {
                  quote: { type: 'string' },
                  start: { type: 'integer' },
                  end: { type: 'integer' }
                }
              }
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      }
    },
    required: ['companies']
  }
} as const;
