import React from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { AddProductModal } from './AddProductModal';
import { ChangePwdModal } from './ChangePwdModal';
import { LearnConfirmModal } from './LearnConfirmModal';
import { LoginModal } from './LoginModal';

interface Props {
  onLearnConfirm: (categoryRoot: string) => void;
}

/** 按弹窗类型渲染对应模态框。 */
export const ModalRouter: React.FC<Props> = ({ onLearnConfirm }) => {
  const loginModal = useAppStore(s => s.loginModal);
  const changePwdModal = useAppStore(s => s.changePwdModal);
  const addProductModal = useAppStore(s => s.addProductModal);
  const learnConfirmModal = useAppStore(s => s.learnConfirmModal);

  return (
    <>
      {loginModal && <LoginModal />}
      {changePwdModal && <ChangePwdModal />}
      {addProductModal && <AddProductModal />}
      {learnConfirmModal && <LearnConfirmModal onConfirm={onLearnConfirm} />}
    </>
  );
};
