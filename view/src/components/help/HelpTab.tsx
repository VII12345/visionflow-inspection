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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-accent font-semibold">USER GUIDE</div>
            <h2 className="text-xl font-semibold text-text-primary mt-2">系统说明书</h2>
            <p className="text-xs text-text-secondary mt-2 leading-5">按照“先准备数据、再训练模型、最后运行检测”的顺序操作即可。页面中带有问号的字段，鼠标停留后会显示填写建议。</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center text-lg font-semibold">?</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="第一次使用怎么做"><ol className="list-decimal pl-5 space-y-1"><li>在“用户”页面登录；管理员可以创建账户和分配角色。</li><li>在“文件”页面新增产品，填写用户容易识别的产品名称和稳定的模型标识。</li><li>准备训练图片：选择一个根目录，下面每个子目录代表一个类别。</li><li>在“设置”页面选中产品，选择类别根目录并点击“开始学习”。</li><li>训练完成后，在“模型设置”中选择该模型需要剔除的类别。</li><li>在“文件”页面把产品分配给线体，确认相机和 PLC 后回到“运行”页面启动。</li></ol></Section>
        <Section title="训练图片怎么放"><p>根目录下每个有图片的子目录会被识别为一个类别，例如：</p><pre className="mt-2 rounded-md bg-gray-50 p-3 text-[11px] leading-5">数据集/
├── 合格品/
├── 划痕/
├── 缺角/
└── 污渍/</pre><p className="mt-2">子目录名称会成为模型输出的类别名称。建议每个类别准备数量接近、拍摄环境接近现场的图片。</p></Section>
        <Section title="模型设置怎么用"><p>打开“模型设置”，每个模型会显示自己的类别列表。勾选的类别表示“需要剔除”，未勾选的类别表示“放行”。可以同时勾选多个类别，也可以全部取消。保存后，系统会按照当前线体正在使用的模型读取设置。</p></Section>
        <Section title="PLC 页面怎么填"><ol className="list-decimal pl-5 space-y-1"><li>“PLC 服务地址”填写现场 PLC 程序提供的 HTTP 地址。</li><li>“节点名称前缀”只有在 PLC 程序要求统一前缀时填写；如果输入的节点名称已经是完整名称，可以留空。</li><li>相机映射表中的三个节点必须按现场 PLC 程序实际名称填写，页面中的示例值不能直接照抄。</li><li>保存后可用“测试信号”或“测试时间”验证通信；测试前请确认设备处于安全状态。</li></ol></Section>
        <Section title="运行和停止"><p>“运行”页面的“启动”和“停止”是设备控制按钮。启动前请确认线体已经分配模型、相机连接正常、PLC 配置已保存。运行中不要修改线体数量和相机关键参数，停止设备后再修改。</p></Section>
        <Section title="测试和照片"><p>“测试”页面的“分类测试”需要类别根目录，可以查看准确率和每个类别的统计；“批量推理”只需要图片目录。检测照片可以在“文件”页面或相机详情中查看，照片子目录名称就是实际识别类别。</p></Section>
        <Section title="用户权限"><ul className="list-disc pl-5 space-y-1"><li>管理员：最高权限，可以使用和配置全部功能，修改密码和保持登录设置也只有管理员可以操作。</li><li>技术员：可以启动/停止设备，并使用用户管理之外的设置、模型、PLC 和测试功能。</li><li>操作员：只能启动和停止设备，其他功能不可操作。</li></ul></Section>
        <Section title="网页访问和常见问题"><p>免安装版启动后，可以在本机浏览器打开 <code>http://127.0.0.1:5173</code>；局域网其他电脑使用运行该程序电脑的 IP 地址访问。如果页面提示后端不可用，请先检查程序是否已启动、5000 和 5173 端口是否被占用。</p></Section>
      </div>
      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={() => setActiveTab('settings')}>前往设置</Button></div>
    </div>
  );
};
