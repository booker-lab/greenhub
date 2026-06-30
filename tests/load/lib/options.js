const profiles = {
  smoke: {
    vus: 1,
    iterations: 1,
  },
  baseline: {
    stages: [
      { duration: '2m', target: 10 },
      { duration: '6m', target: 20 },
      { duration: '2m', target: 0 },
    ],
  },
  launch: {
    stages: [
      { duration: '3m', target: 25 },
      { duration: '9m', target: 50 },
      { duration: '3m', target: 0 },
    ],
  },
  growth: {
    stages: [
      { duration: '5m', target: 50 },
      { duration: '10m', target: 100 },
      { duration: '5m', target: 0 },
    ],
  },
  spike: {
    stages: [
      { duration: '30s', target: 20 },
      { duration: '1m', target: 150 },
      { duration: '2m', target: 150 },
      { duration: '30s', target: 0 },
    ],
  },
  soak: {
    stages: [
      { duration: '5m', target: 30 },
      { duration: '50m', target: 30 },
      { duration: '5m', target: 0 },
    ],
  },
};

export function scenarioOptions(profile, extraThresholds = {}) {
  return {
    ...(profiles[profile] || profiles.smoke),
    thresholds: {
      http_req_failed: ['rate<0.01'],
      http_req_duration: ['p(95)<1000', 'p(99)<2500'],
      checks: ['rate>0.99'],
      ...extraThresholds,
    },
  };
}
