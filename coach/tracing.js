const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { AlwaysOnSampler } = require('@opentelemetry/sdk-trace-base');

const serviceName = process.env.OTEL_SERVICE_NAME || 'chess-coach-agent';
const collectorUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

console.log(`[OTel] Coach agent telemetry: ${serviceName} -> ${collectorUrl}`);

const traceExporter = new OTLPTraceExporter({ url: `${collectorUrl}/v1/traces` });
const metricExporter = new OTLPMetricExporter({ url: `${collectorUrl}/v1/metrics` });
const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 5000 });

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    'environment': process.env.NODE_ENV || 'development',
    'agent.type': 'llm-coach',
  }),
  sampler: new AlwaysOnSampler(),
  traceExporter,
  metricReader,
  instrumentations: [
    getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[OTel] Coach agent telemetry stopped'))
    .catch((error) => console.error('[OTel] Error stopping telemetry', error))
    .finally(() => process.exit(0));
});

module.exports = sdk;
