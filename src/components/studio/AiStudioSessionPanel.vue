<template>
  <v-sheet rounded="lg" class="studio-ai-sessions studio-screen__panel">
    <StudioErrorNotice
      v-if="pageError"
      title="AI Studio sessions could not load"
      :error="pageError"
      compact
      class="mb-3"
    />

    <div class="studio-ai-sessions__toolbar">
      <div class="studio-ai-sessions__tabs">
        <v-chip
          v-for="session in sessions"
          :key="session.sessionId"
          :color="session.sessionId === selectedSessionId ? 'primary' : 'default'"
          :variant="session.sessionId === selectedSessionId ? 'flat' : 'tonal'"
          class="studio-ai-sessions__tab"
          size="large"
          @click="selectSession(session.sessionId)"
        >
          <span
            class="studio-ai-sessions__status-dot"
            :class="`studio-ai-sessions__status-dot--${session.status}`"
          />
          <span>{{ shortSessionId(session.sessionId) }}</span>
          <v-btn
            v-if="session.sessionId === selectedSessionId"
            class="studio-ai-sessions__tab-abandon"
            density="compact"
            :disabled="commandBusy || isSelectedSessionClosed"
            :icon="mdiClose"
            :loading="abandonCommand.isRunning"
            size="x-small"
            title="Abandon session"
            variant="text"
            aria-label="Abandon session"
            @click.stop="requestAbandonSelectedSession"
          />
        </v-chip>

        <v-btn
          color="primary"
          variant="tonal"
          :disabled="!canCreateSession || commandBusy"
          :loading="createSessionCommand.isRunning"
          :prepend-icon="mdiPlus"
          :title="createSessionTitle"
          @click="createSessionCommand.run()"
        >
          New Session
        </v-btn>
      </div>
    </div>

    <v-progress-linear
      v-if="pageLoading && !selectedSession"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-sheet
      v-else-if="!selectedSession"
      rounded="lg"
      border
      class="studio-ai-sessions__empty"
    >
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <div v-else class="studio-ai-sessions__layout">
      <section class="studio-ai-sessions__main">
        <div class="studio-ai-sessions__heading">
          <div>
            <p class="studio-ai-sessions__eyebrow">AI Studio session</p>
            <h2 class="studio-ai-sessions__title">{{ selectedSessionTitle }}</h2>
          </div>
          <v-chip
            :color="aiStudioSessionStatusColor(selectedSession.status)"
            variant="tonal"
          >
            {{ aiStudioSessionStatusLabel(selectedSession.status) }}
          </v-chip>
        </div>

        <AiStudioSessionTimeline
          :busy="commandBusy"
          :steps="timelineSteps"
        >
          <template #current-step>
            <div class="studio-ai-sessions__actions">
              <v-btn
                v-for="action in currentActions"
                :key="action.id"
                color="primary"
                variant="flat"
                :disabled="commandBusy || action.enabled !== true"
                :loading="runActionCommand.isRunning && activeActionId === action.id"
                :prepend-icon="actionIcon(action)"
                :title="action.disabledReason || action.label"
                @click="runAction(action)"
              >
                {{ action.label }}
              </v-btn>

              <v-btn
                v-if="currentNext?.visible"
                color="primary"
                variant="tonal"
                :disabled="commandBusy || currentNext.enabled !== true"
                :loading="advanceCommand.isRunning"
                :prepend-icon="mdiArrowRight"
                :title="currentNext.disabledReason || currentNext.label || 'Next'"
                @click="goNext"
              >
                {{ currentNext.label || "Next" }}
              </v-btn>
            </div>

            <v-alert
              v-if="actionResultMessage"
              :type="actionResultType"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ actionResultMessage }}
            </v-alert>

            <v-alert
              v-if="currentStepDisabledReason"
              type="info"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ currentStepDisabledReason }}
            </v-alert>

            <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">
              {{ copyStatus }}
            </p>
          </template>
        </AiStudioSessionTimeline>

        <AiStudioSessionFacts
          class="studio-ai-sessions__facts"
          :facts="sessionFacts"
          :status-color="aiStudioSessionStatusColor(selectedSession.status)"
          :status-label="aiStudioSessionStatusLabel(selectedSession.status)"
          @copy="copyText"
        />
      </section>

      <section class="studio-ai-sessions__terminals">
        <CodexSessionTerminal
          :prompt-injection-request-key="codexPromptInjectionKey"
          :prompt-override="codexPromptOverride"
          :session="selectedSession"
          @prompt-injected="handleCodexPromptInjected"
          @prompt-injection-failed="handleCodexPromptInjectionFailed"
          @session-update="handleCodexSessionUpdate"
        />

        <div
          v-if="commandTerminalVisible"
          class="studio-ai-sessions__command-overlay"
        >
          <AiStudioCommandTerminal
            class="studio-ai-sessions__command-terminal"
            :action="commandTerminalAction"
            :session="selectedSession"
            :start-request-key="commandTerminalStartKey"
            @closed="handleCommandTerminalClosed"
            @finished="handleCommandTerminalFinished"
            @running-changed="handleCommandTerminalRunningChanged"
          />
        </div>
      </section>
    </div>

    <AiStudioDraftEditorDialog
      v-model="draftEditorOpen"
      v-model:body-text="draftEditorBody"
      v-model:issue-title="draftEditorIssueTitle"
      :error="draftEditorError"
      :kind="draftEditorKind"
      :loading="draftEditorLoading"
      :saving="draftEditorSaving"
      @save="saveDraftEditor"
    />

    <v-dialog
      v-model="abandonDialogOpen"
      max-width="520"
      persistent
    >
      <v-card class="studio-ai-sessions__abandon-dialog">
        <v-card-title class="studio-ai-sessions__abandon-title">
          <v-icon :icon="mdiAlertCircleOutline" color="warning" />
          Abandon session?
        </v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-2">
            This will mark the session as abandoned and close its terminals.
          </p>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Session: <strong>{{ abandonDialogSessionTitle || shortSessionId(abandonDialogSessionId) }}</strong>
          </p>
        </v-card-text>
        <v-card-actions class="studio-ai-sessions__abandon-actions">
          <v-btn
            variant="text"
            :disabled="abandonCommand.isRunning"
            @click="cancelAbandonSession"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            variant="flat"
            :loading="abandonCommand.isRunning"
            @click="confirmAbandonSession"
          >
            Abandon session
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-sheet>
</template>

<script setup>
import {
  mdiAlertCircleOutline,
  mdiArrowRight,
  mdiClose,
  mdiPlus
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import AiStudioDraftEditorDialog from "@/components/studio/AiStudioDraftEditorDialog.vue";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import AiStudioSessionFacts from "@/components/studio/ai-studio-session/AiStudioSessionFacts.vue";
import AiStudioSessionTimeline from "@/components/studio/ai-studio-session/AiStudioSessionTimeline.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useAiStudioSessions
} from "@/composables/useAiStudioSessions.js";

const emit = defineEmits(["title-change"]);

const {
  abandonCommand,
  abandonDialogOpen,
  abandonDialogSessionId,
  abandonDialogSessionTitle,
  actionIcon,
  actionResultMessage,
  actionResultType,
  activeActionId,
  advanceCommand,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  canCreateSession,
  cancelAbandonSession,
  codexPromptInjectionKey,
  codexPromptOverride,
  commandBusy,
  commandTerminalAction,
  commandTerminalStartKey,
  commandTerminalVisible,
  confirmAbandonSession,
  copyStatus,
  copyText,
  createSessionCommand,
  createSessionTitle,
  currentActions,
  currentNext,
  currentStepDisabledReason,
  draftEditorBody,
  draftEditorError,
  draftEditorIssueTitle,
  draftEditorKind,
  draftEditorLoading,
  draftEditorOpen,
  draftEditorSaving,
  goNext,
  handleCodexPromptInjected,
  handleCodexPromptInjectionFailed,
  handleCodexSessionUpdate,
  handleCommandTerminalClosed,
  handleCommandTerminalFinished,
  handleCommandTerminalRunningChanged,
  isSelectedSessionClosed,
  pageError,
  pageLoading,
  requestAbandonSelectedSession,
  runAction,
  runActionCommand,
  saveDraftEditor,
  selectSession,
  selectedSession,
  selectedSessionId,
  selectedSessionTitle,
  sessionFacts,
  sessions,
  shortSessionId,
  timelineSteps
} = useAiStudioSessions({
  onTitleChange(title) {
    emit("title-change", title);
  }
});
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  min-height: 0;
}

.studio-ai-sessions__toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-ai-sessions__tabs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
}

.studio-ai-sessions__tab {
  align-items: center;
  max-width: 18rem;
}

.studio-ai-sessions__tab-abandon {
  margin-left: 0.3rem;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  display: inline-block;
  height: 0.52rem;
  margin-right: 0.42rem;
  width: 0.52rem;
}

.studio-ai-sessions__status-dot--abandoned,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-ai-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
}

.studio-ai-sessions__empty {
  padding: 0.9rem;
}

.studio-ai-sessions__layout {
  align-items: flex-start;
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(22rem, 0.95fr) minmax(24rem, 1.05fr);
}

.studio-ai-sessions__main,
.studio-ai-sessions__terminals {
  min-width: 0;
}

.studio-ai-sessions__facts {
  margin-top: 0.9rem;
}

.studio-ai-sessions__heading {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  min-width: 0;
}

.studio-ai-sessions__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin: 0 0 0.18rem;
  text-transform: uppercase;
}

.studio-ai-sessions__title {
  font-size: 1.08rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.18;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-ai-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}

.studio-ai-sessions__abandon-dialog {
  border: 1px solid rgba(var(--v-theme-warning), 0.32);
}

.studio-ai-sessions__abandon-title,
.studio-ai-sessions__abandon-actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-sessions__abandon-actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}

.studio-ai-sessions__terminals {
  position: sticky;
  top: 0.75rem;
}

.studio-ai-sessions__command-overlay {
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 8px;
  display: flex;
  inset: 0;
  padding: 0.5rem;
  position: absolute;
  z-index: 2;
}

.studio-ai-sessions__command-terminal {
  flex: 1 1 auto;
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.28);
  height: 100%;
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }

  .studio-ai-sessions__terminals {
    position: relative;
    top: auto;
  }
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar,
  .studio-ai-sessions__heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
