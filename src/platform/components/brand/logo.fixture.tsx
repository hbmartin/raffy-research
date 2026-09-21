import { Logo } from '@/platform/components/brand/logo';
const Default = () => {
  return <Logo />;
};

const Color = () => {
  return <Logo className="text-neutral-400" />;
};

const Collapsed = () => {
  return (
    <div className="group" data-collapsible="icon">
      <Logo />
    </div>
  );
};

export default {
  Default,
  Color,
  Collapsed,
};
