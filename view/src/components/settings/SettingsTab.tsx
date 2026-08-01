import React, { useState } from 'react';
import { Button } from '../common/Modal';
import { useAppStore } from '../../store/useAppStore';
import { HardwarePanel } from './HardwarePanel';
import { LineCountSection } from './LineCountSection';
import { ProductSection } from './ProductSection';
import { SavePolicySection } from './SavePolicySection';
import { TrainingSection } from './TrainingSection';
import { useProductLearningSync } from './useProductLearningSync';
import { useTrainingPanel } from './useTrainingPanel';

export const SettingsTab: React.FC = () => {
  const setCameraConfigCamId = useAppStore(s => s.setCameraConfigCamId);
  const lineCount = useAppStore(s => s.lineCount);
  const { products, refresh } = useProductLearningSync();
  const [selectedModel, setSelectedModel] = useState<{ model: string; id: number } | null>(null);
  const training = useTrainingPanel({ products, selectedModel, onTrainingComplete: refresh });

  return (
    <div className="flex gap-6 h-full overflow-auto">
      {/* Left: Model List */}
      <ProductSection products={products} selectedModel={selectedModel} onSelect={setSelectedModel} />

      {/* Right: AI Controls + Camera Config + Hardware */}
      <div className="w-1/2 flex flex-col gap-5">
        {/* AI Learning */}
        <TrainingSection
          products={products}
          selectedModel={selectedModel}
          running={training.trainingRunning}
          progress={training.trainingProgress}
          progressLabel={training.trainingProgressLabel}
          metrics={training.trainingMetrics}
          onStart={training.startLearning}
          onStop={training.stopLearning}
        />

        {/* Line Count */}
        <LineCountSection />

        {/* Save Policy */}
        <SavePolicySection />

        {/* Camera Config */}
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">相机参数设置</h3>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: lineCount }, (_, i) => i + 1).map(camId => (
              <Button
                key={camId}
                variant="secondary"
                onClick={() => setCameraConfigCamId(camId)}
                className="!py-3 !text-sm !font-medium !justify-start"
              >
                相机 {camId}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-text-tertiary mt-3">需要技术员或以上权限</p>
        </div>

        <HardwarePanel />
      </div>
    </div>
  );
};
