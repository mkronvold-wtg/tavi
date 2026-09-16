import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ApiError,
  getRetentionStatus,
  pruneRetentionData,
  updateRetentionSettings,
} from "./api";
import { Modal } from "./Modal";
import type {
  LogRetentionSummary,
  LogRetentionWindow,
  NotificationRetentionSummary,
  NotificationRetentionWindow,
  RetentionStatus,
  RetentionTarget,
  UpdateRetentionSettingsPayload,
} from "./types";

const LOG_RETENTION_OPTIONS: Array<{
  label: string;
  value: LogRetentionWindow;
}> = [
  { label: "3 months", value: "three_months" },
  { label: "6 months", value: "six_months" },
  { label: "12 months", value: "twelve_months" },
  { label: "24 months", value: "twenty_four_months" },
  { label: "36 months", value: "thirty_six_months" },
];

const NOTIFICATION_RETENTION_OPTIONS: Array<{
  label: string;
  value: NotificationRetentionWindow;
}> = [
  { label: "1 week", value: "one_week" },
  { label: "2 weeks", value: "two_weeks" },
  { label: "1 month", value: "one_month" },
];

type RetentionSettingsPanelProps = {
  onClose: () => void;
};

export function RetentionSettingsPanel({
  onClose,
}: RetentionSettingsPanelProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPruneTarget, setPendingPruneTarget] =
    useState<RetentionTarget | null>(null);

  const retentionQuery = useQuery({
    queryFn: getRetentionStatus,
    queryKey: ["retention-status"],
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: updateRetentionSettings,
    onSuccess: (status) => {
      queryClient.setQueryData(["retention-status"], status);
      setError(null);
      setMessage("Retention settings saved.");
    },
    onError: (nextError) => {
      setMessage(null);
      setError(
        nextError instanceof ApiError
          ? nextError.message
          : "Unable to update retention settings.",
      );
    },
  });

  const pruneMutation = useMutation({
    mutationFn: pruneRetentionData,
    onSuccess: (result) => {
      queryClient.setQueryData(["retention-status"], result.settings);
      setPendingPruneTarget(null);
      setError(null);
      setMessage(
        `Pruned ${formatRetentionTargetLabel(result.target)}: removed ${formatBytes(result.deletedSizeBytes)} across ${formatCountLabel(result.deletedCount, "item")}.`,
      );
    },
    onError: (nextError) => {
      setMessage(null);
      setError(
        nextError instanceof ApiError
          ? nextError.message
          : "Unable to prune retained data.",
      );
    },
  });

  const status = retentionQuery.data;
  const controlsDisabled =
    retentionQuery.isLoading ||
    updateMutation.isPending ||
    pruneMutation.isPending;
  const retentionDraft = useMemo(() => toRetentionDraft(status), [status]);

  const handleRetentionChange = <
    Target extends keyof UpdateRetentionSettingsPayload,
  >(
    target: Target,
    value: UpdateRetentionSettingsPayload[Target],
  ) => {
    if (!retentionDraft) {
      return;
    }

    setError(null);
    setMessage(null);
    updateMutation.mutate({
      ...retentionDraft,
      [target]: value,
    });
  };

  const handlePrune = (target: RetentionTarget) => {
    if (!retentionDraft) {
      return;
    }

    const policyLabel = formatCurrentPolicyLabel(target, retentionDraft);

    setPendingPruneTarget(target);
    setMessage(
      `Ready to prune ${formatRetentionTargetLabel(target)} older than ${policyLabel}.`,
    );
  };

  const confirmPrune = () => {
    if (!pendingPruneTarget) {
      return;
    }

    setError(null);
    setMessage(null);
    pruneMutation.mutate({ target: pendingPruneTarget });
  };

  return (
    <section className="audit-card audit-card--report retention-panel">
      <div className="panel-header">
        <div>
          <strong>Retention</strong>
          <p className="toolbar-hint">
            Control how long admin-visible logs stay in storage. Backup
            retention is configured from Settings → Backups.
          </p>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <p className="toolbar-hint retention-note">
        Sizes reflect what would remain if each retention rule were applied now.
      </p>

      {retentionQuery.isLoading ? <p>Loading retention settings...</p> : null}
      {retentionQuery.isError ? (
        <p className="error-banner">
          {retentionQuery.error instanceof Error
            ? retentionQuery.error.message
            : "Unable to load retention settings."}
        </p>
      ) : null}
      {message ? (
        <p className="toolbar-hint audit-retention-status">{message}</p>
      ) : null}
      {error ? <p className="error-banner">{error}</p> : null}

      {status ? (
        <div className="retention-list">
          <RetentionRow
            actionLabel={
              pruneMutation.isPending &&
              pruneMutation.variables?.target === "logins"
                ? "Pruning..."
                : "Prune now"
            }
            controlsDisabled={controlsDisabled}
            estimate={formatEstimate(status.logins, "event")}
            label="Personal logins"
            onChange={(value) => handleRetentionChange("logins", value)}
            onPrune={() => handlePrune("logins")}
            options={LOG_RETENTION_OPTIONS}
            value={status.logins.policy}
          />
          <RetentionRow
            actionLabel={
              pruneMutation.isPending &&
              pruneMutation.variables?.target === "changes"
                ? "Pruning..."
                : "Prune now"
            }
            controlsDisabled={controlsDisabled}
            estimate={formatEstimate(status.changes, "event")}
            label="Changes"
            onChange={(value) => handleRetentionChange("changes", value)}
            onPrune={() => handlePrune("changes")}
            options={LOG_RETENTION_OPTIONS}
            value={status.changes.policy}
          />
          <RetentionRow
            actionLabel={
              pruneMutation.isPending &&
              pruneMutation.variables?.target === "notifications"
                ? "Pruning..."
                : "Prune now"
            }
            controlsDisabled={controlsDisabled}
            estimate={formatEstimate(status.notifications, "record")}
            label="Notifications"
            onChange={(value) => handleRetentionChange("notifications", value)}
            onPrune={() => handlePrune("notifications")}
            options={NOTIFICATION_RETENTION_OPTIONS}
            value={status.notifications.policy}
          />
        </div>
      ) : null}
      {pendingPruneTarget && retentionDraft ? (
        <RetentionPruneModal
          isPruning={pruneMutation.isPending}
          onCancel={() => {
            if (!pruneMutation.isPending) {
              setPendingPruneTarget(null);
              setMessage(null);
            }
          }}
          onConfirm={confirmPrune}
          policyLabel={formatCurrentPolicyLabel(
            pendingPruneTarget,
            retentionDraft,
          )}
          target={pendingPruneTarget}
        />
      ) : null}
    </section>
  );
}

type RetentionPruneModalProps = {
  isPruning: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  policyLabel: string;
  target: RetentionTarget;
};

function RetentionPruneModal({
  isPruning,
  onCancel,
  onConfirm,
  policyLabel,
  target,
}: RetentionPruneModalProps) {
  return (
    <Modal
      className="modal-dialog--danger"
      disableDismiss={isPruning}
      onClose={onCancel}
      subtitle={`Older than ${policyLabel}`}
      title={`Prune ${formatRetentionTargetLabel(target)}`}
      footer={
        <div className="modal-actions">
          <button
            type="button"
            className="danger-button"
            disabled={isPruning}
            onClick={onConfirm}
          >
            {isPruning ? "Pruning..." : "Prune now"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={isPruning}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      }
    >
      <p className="toolbar-hint">
        This removes retained {formatRetentionTargetLabel(target)} older than
        the current retention policy.
      </p>
    </Modal>
  );
}

type RetentionRowProps<Value extends string> = {
  actionLabel: string;
  controlsDisabled: boolean;
  estimate: string;
  label: string;
  onChange: (value: Value) => void;
  onPrune: () => void;
  options: Array<{ label: string; value: Value }>;
  value: Value;
};

function RetentionRow<Value extends string>({
  actionLabel,
  controlsDisabled,
  estimate,
  label,
  onChange,
  onPrune,
  options,
  value,
}: RetentionRowProps<Value>) {
  return (
    <div className="retention-row">
      <div className="retention-row-main">
        <strong>{label}</strong>
        <span className="toolbar-hint">{estimate}</span>
      </div>
      <div className="retention-row-controls">
        <label className="workspace-filter retention-filter">
          <select
            aria-label={`${label} retention`}
            disabled={controlsDisabled}
            value={value}
            onChange={(event) => onChange(event.target.value as Value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost-button compact-button"
          disabled={controlsDisabled}
          onClick={onPrune}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function toRetentionDraft(status: RetentionStatus | undefined) {
  if (!status) {
    return null;
  }

  return {
    changes: status.changes.policy,
    logins: status.logins.policy,
    notifications: status.notifications.policy,
  } satisfies UpdateRetentionSettingsPayload;
}

function formatEstimate(
  summary: LogRetentionSummary | NotificationRetentionSummary,
  itemLabel: string,
) {
  return `${formatBytes(summary.estimatedSizeBytes)} across ${formatCountLabel(summary.retainedItemCount, itemLabel)}.`;
}

function formatCountLabel(count: number, singular: string) {
  return `${count.toString()} ${count === 1 ? singular : `${singular}s`}`;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRetentionTargetLabel(target: RetentionTarget) {
  switch (target) {
    case "backups":
      return "backups";
    case "logins":
      return "personal logins";
    case "changes":
      return "changes";
    case "notifications":
      return "notifications";
  }
}

function formatCurrentPolicyLabel(
  target: RetentionTarget,
  draft: UpdateRetentionSettingsPayload,
) {
  switch (target) {
    case "backups":
      return "the backup policy in Backups";
    case "logins":
      return formatPolicyLabel(draft.logins, LOG_RETENTION_OPTIONS);
    case "changes":
      return formatPolicyLabel(draft.changes, LOG_RETENTION_OPTIONS);
    case "notifications":
      return formatPolicyLabel(
        draft.notifications,
        NOTIFICATION_RETENTION_OPTIONS,
      );
  }
}

function formatPolicyLabel<Value extends string>(
  value: Value,
  options: Array<{ label: string; value: Value }>,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}
