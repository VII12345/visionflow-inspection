import React from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { storage } from '../../../services/storage';
import { Button } from '../Button';
import { Modal } from '../Modal';

/** 后端目录未初始化但本机残留产品/线体数据时，询问是否迁移恢复。 */
export const CatalogMigrationModal: React.FC = () => {
  const pendingCatalogMigration = useAppStore(s => s.pendingCatalogMigration);
  const showMessage = useAppStore(s => s.showMessage);
  if (!pendingCatalogMigration) return null;

  const productCount = pendingCatalogMigration.products.length;

  const handleRestore = () => { void storage.applyCatalogMigration(true); };
  const handleDiscard = () => { void storage.applyCatalogMigration(false); };

  return (
    <Modal
      open={true}
      onClose={() => showMessage('请选择「恢复」或「不恢复，从空开始」')}
      title="检测到本地残留目录数据"
      closeOnBackdrop={false}
      footer={<>
        <Button variant="primary" onClick={handleRestore}>恢复</Button>
        <Button variant="secondary" onClick={handleDiscard}>不恢复，从空开始</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-primary">
          当前环境尚未初始化产品/线体目录，但本机残留了
          {productCount > 0 ? ` ${productCount} 个产品` : ' 线体配置'}。
        </p>
        <p className="text-sm text-text-tertiary">
          是否将本地残留数据恢复到当前环境？若刚清空过数据，请选择「不恢复，从空开始」。
        </p>
      </div>
    </Modal>
  );
};
