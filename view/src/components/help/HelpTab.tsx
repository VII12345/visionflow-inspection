import React from 'react';
import { Button } from '../common/Modal';
import { useAppStore } from '../../store/useAppStore';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
    <h3 className="text-[15px] font-semibold text-text-primary mb-3">{title}</h3>
    <div className="text-[12px] text-text-secondary leading-6">{children}</div>
  </section>
);

export const HelpTab: React.FC = () => {
  const setActiveTab = useAppStore(s => s.setActiveTab);
  return (
    <div className="flex flex-col gap-5 overflow-auto h-full">
      <div className="bg-gradient-to-br from-blue-50 to-white rounded-lg border border-blue-100 p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[11px] uppercase tracking-[0.18em] text-accent font-semibold">USER GUIDE</div><h2 className="text-xl font-semibold text-text-primary mt-2">系统说明书</h2><p className="text-xs text-text-secondary mt-2 leading-5">这里介绍产品类别、线体、PLC、训练、测试和运行页面的基本操作。</p></div>
          <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center text-lg font-semibold">?</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <Section title="快速开始"><ol className="list-decimal pl-5"><li>在“文件”页面新增产品，填写产品名称、模型标识和尺寸。</li><li>把训练图片放在一个根目录下，每个子目录代表一个类别，类别数量不限。</li><li>在“设置”中选择产品并开始学习。</li><li>在“文件”页面把产品分配给对应线体，再到“运行”页面启动检测。</li></ol></Section>
        <Section title="多类别数据目录"><p>例如：根目录下可以有“合格”“缺陷”“划伤”“异物”等任意数量的子目录。系统会按子目录名称建立类别，并把类别名称保存到模型元数据中。</p></Section>
        <Section title="PLC 配置"><p>在“PLC”页面编辑 PLC 接口地址、节点前缀、超时时间、各相机的时间/延时/信号节点，以及哪些类别触发剔除。保存后，实际检测和测试写入都会使用新配置。</p></Section>
        <Section title="测试与历史照片"><p>“测试”页面可选择模型和类别根目录进行分类测试，也可以选择普通图片目录进行批量推理。“文件”页面和相机详情页面可查看检测照片、状态和保存设置。</p></Section>
      </div>
      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={() => setActiveTab('settings')}>前往设置</Button></div>
    </div>
  );
};
