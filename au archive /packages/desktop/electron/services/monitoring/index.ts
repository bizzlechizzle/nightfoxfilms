/**
 * Monitoring module - comprehensive observability for AU Archive
 *
 * Exports:
 * - MetricsCollector: Time-series performance data
 * - Tracer: Distributed tracing for multi-step operations
 * - AlertManager: Proactive problem detection
 *
 * @module services/monitoring
 */

export {
  MetricsCollector,
  getMetricsCollector,
  MetricNames,
  type Metric,
  type MetricsSummary,
  type HistogramStats,
  type TimerHandle,
} from './metrics-collector';

export {
  Tracer,
  getTracer,
  OperationNames,
  type Span,
  type SpanHandle,
  type SpanLog,
  type TraceContext,
} from './tracer';

export {
  AlertManager,
  getAlertManager,
  type Alert,
  type AlertRule,
  type AlertSeverity,
  type AlertMetrics,
} from './alert-manager';
