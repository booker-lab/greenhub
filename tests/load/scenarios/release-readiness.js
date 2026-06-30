import { sleep } from 'k6';
import { login } from '../lib/auth.js';
import { PROFILE, hasCredentials } from '../lib/env.js';
import {
  adminOpsFlow,
  checkoutReadFlow,
  driverOpsFlow,
  publicReadFlow,
  sellerOpsFlow,
} from '../lib/flows.js';

const profileConfig = {
  smoke: {
    duration: '1m',
    publicRead: 1,
    checkout: 1,
    sellerOps: 0,
    adminOps: 0,
    driverOps: 0,
  },
  baseline: {
    duration: '10m',
    publicRead: 20,
    checkout: 5,
    sellerOps: 3,
    adminOps: 3,
    driverOps: 3,
  },
  launch: {
    duration: '15m',
    publicRead: 50,
    checkout: 10,
    sellerOps: 5,
    adminOps: 5,
    driverOps: 5,
  },
  growth: {
    duration: '20m',
    publicRead: 100,
    checkout: 20,
    sellerOps: 10,
    adminOps: 10,
    driverOps: 10,
  },
  spike: {
    duration: '5m',
    publicRead: 150,
    checkout: 10,
    sellerOps: 5,
    adminOps: 5,
    driverOps: 5,
  },
  soak: {
    duration: '60m',
    publicRead: 30,
    checkout: 6,
    sellerOps: 3,
    adminOps: 3,
    driverOps: 3,
  },
};

function constantScenario(exec, vus, duration) {
  return {
    executor: 'constant-vus',
    exec,
    vus,
    duration,
    gracefulStop: '30s',
  };
}

function smokeScenario(exec) {
  return {
    executor: 'shared-iterations',
    exec,
    vus: 1,
    iterations: 1,
    maxDuration: '1m',
  };
}

function buildScenarios() {
  const config = profileConfig[PROFILE] || profileConfig.smoke;

  if (PROFILE === 'smoke') {
    return {
      public_read: smokeScenario('publicRead'),
      checkout: smokeScenario('checkout'),
    };
  }

  const scenarios = {
    public_read: constantScenario('publicRead', config.publicRead, config.duration),
    checkout: constantScenario('checkout', config.checkout, config.duration),
  };

  if (config.sellerOps > 0 && hasCredentials('seller')) {
    scenarios.seller_ops = constantScenario('sellerOps', config.sellerOps, config.duration);
  }
  if (config.adminOps > 0 && hasCredentials('admin')) {
    scenarios.admin_ops = constantScenario('adminOps', config.adminOps, config.duration);
  }
  if (config.driverOps > 0 && hasCredentials('driver')) {
    scenarios.driver_ops = constantScenario('driverOps', config.driverOps, config.duration);
  }

  return scenarios;
}

function buildThresholds() {
  const thresholds = {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{flow:public_read}': ['p(95)<800', 'p(99)<2000'],
    'http_req_duration{flow:checkout}': ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.99'],
  };

  if (PROFILE !== 'smoke' && hasCredentials('seller')) {
    thresholds['http_req_duration{flow:seller_ops}'] = ['p(95)<1000', 'p(99)<2500'];
  }
  if (PROFILE !== 'smoke' && hasCredentials('admin')) {
    thresholds['http_req_duration{flow:admin_ops}'] = ['p(95)<1000', 'p(99)<2500'];
  }
  if (PROFILE !== 'smoke' && hasCredentials('driver')) {
    thresholds['http_req_duration{flow:driver_ops}'] = ['p(95)<1000', 'p(99)<2500'];
  }

  return thresholds;
}

export const options = {
  scenarios: buildScenarios(),
  thresholds: buildThresholds(),
};

export function setup() {
  return {
    consumerToken: login('consumer'),
    sellerToken: login('seller'),
    adminToken: login('admin'),
    driverToken: login('driver'),
  };
}

export function publicRead() {
  publicReadFlow();
  sleep(1);
}

export function checkout(data) {
  checkoutReadFlow(data.consumerToken);
  sleep(1);
}

export function sellerOps(data) {
  sellerOpsFlow(data.sellerToken);
  sleep(1);
}

export function adminOps(data) {
  adminOpsFlow(data.adminToken);
  sleep(1);
}

export function driverOps(data) {
  driverOpsFlow(data.driverToken);
  sleep(1);
}
