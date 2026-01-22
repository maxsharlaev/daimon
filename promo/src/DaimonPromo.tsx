import "./styles/style.css";
import "./styles/ui.css";
import "./styles/forms.scss";
import "./styles/App.css";
import "./styles/components.css";

import { AppPromo } from "./promo/AppPromo";

type Props = {
  height?: string | number;
};

export function DaimonPromo({ height = "100%" }: Props) {
  return (
    <div style={{ height }}>
      <AppPromo />
    </div>
  );
}
