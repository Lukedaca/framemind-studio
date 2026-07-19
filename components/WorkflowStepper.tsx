
import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import type { WorkflowStep } from '../types';

interface WorkflowStepperProps {
  currentStep: WorkflowStep;
}

const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ currentStep }) => {
  const { t } = useTranslation();

  const steps: { id: WorkflowStep, label: string }[] = [
    { id: 'import', label: t.pipeline_step_import },
    { id: 'culling', label: t.pipeline_step_culling },
    { id: 'edit', label: t.pipeline_step_edit },
    { id: 'retouch', label: t.pipeline_step_retouch },
    { id: 'export', label: t.pipeline_step_export },
  ];

  const currentIdx = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="w-full bg-surface/20 border-b border-border-subtle py-4 px-8 overflow-hidden">
      <div className="max-w-4xl mx-auto flex items-center justify-between relative">
        {/* Progress Line */}
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-elevated -translate-y-1/2 z-0"></div>
        <div
          className="absolute top-1/2 left-0 h-0.5 bg-gradient-to-r from-fm-magenta via-fm-blue to-fm-green -translate-y-1/2 z-0 transition-none"
          style={{ width: `${(currentIdx / (steps.length - 1)) * 100}%` }}
        ></div>

        {steps.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isActive = idx === currentIdx;

          return (
            <div key={step.id} className="relative z-10 flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full border-2 transition-none ${
                isActive ? 'bg-fm-blue border-fm-blue shadow-[0_0_10px_rgba(47,111,224,0.7)]' :
                isCompleted ? 'bg-fm-green border-fm-green' : 'bg-surface border-border-subtle'
              }`}></div>
              <span className={`absolute top-6 text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-colors ${
                isActive ? 'text-white' : 'text-text-secondary'
              }`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowStepper;


