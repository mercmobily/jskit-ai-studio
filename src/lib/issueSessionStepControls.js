function buildActiveStepControls({
  actionKind = "",
  automationMode = "manual",
  busy = false,
  codexPromptAlreadyRequested = false,
  codexPromptInjectionReady = false,
  codexWorking = false,
  canRunAction = false,
  hasChoiceForm = false,
  hasExclusiveTextAlternateAction = false,
  hasTextForm = false,
  isTerminalSession = false,
  selectedSessionId = "",
  selectedSessionNeedsSetupTerminal = false,
  selectedStepInputType = "none",
  formSubmitsPrompt = false,
  promptSendBlocked = false,
  executeStepSubmitsPrompt = false,
  stepReadyToAdvance = false,
  terminalBlocked = false
} = {}) {
  const hasForm = Boolean(
    hasChoiceForm ||
    hasTextForm ||
    hasExclusiveTextAlternateAction
  );
  const blocked = Boolean(
    !selectedSessionId ||
    isTerminalSession
  );
  const terminalStepPending = selectedSessionNeedsSetupTerminal || automationMode === "terminal";
  const canClick = !blocked && !busy && !terminalBlocked;
  const isCodexPromptStep = actionKind === "codex_prompt";
  void codexPromptAlreadyRequested;
  const codexPromptInjectionPending = codexPromptInjectionReady;
  const codexPromptPending = automationMode === "codex_prompt";
  const promptStepPending = codexPromptInjectionPending || codexPromptPending;
  const canSendPrompt = canClick && !codexWorking && !promptSendBlocked;
  const executeRequiresPromptSlot = promptStepPending || executeStepSubmitsPrompt;
  const formRequiresPromptSlot = formSubmitsPrompt;
  const automaticStepPending = automationMode === "immediate";
  const stepBlocksExecute = stepReadyToAdvance && !executeStepSubmitsPrompt;
  const manualNoInputStepPending = Boolean(actionKind) &&
    automationMode === "manual" &&
    selectedStepInputType === "none" &&
    actionKind !== "codex_prompt" &&
    actionKind !== "user_check";
  const showExecuteStep = !hasForm &&
    !blocked &&
    !stepBlocksExecute &&
    (
      promptStepPending ||
      isCodexPromptStep ||
      terminalStepPending ||
      automaticStepPending ||
      manualNoInputStepPending
    );
  const showGoNext = !blocked &&
    !showExecuteStep &&
    (
      stepReadyToAdvance ||
      (
        !hasForm &&
        (
          isCodexPromptStep ||
          (actionKind === "user_check" && selectedStepInputType === "none")
        )
      )
    );
  const showFormSubmit = hasForm &&
    !hasChoiceForm &&
    !hasExclusiveTextAlternateAction &&
    !stepReadyToAdvance;

  return {
    canExecuteStep: showExecuteStep && (executeRequiresPromptSlot ? canSendPrompt : canClick),
    canGoNext: showGoNext && canClick && !codexWorking,
    canSubmitForm: showFormSubmit && canRunAction && (formRequiresPromptSlot ? canSendPrompt : true),
    hasForm,
    showExecuteStep,
    showFormSubmit,
    showGoNext
  };
}

export {
  buildActiveStepControls
};
