import "./styles/style.css";
import "./styles/ui.css";
import "./styles/forms.scss";
import "./styles/App.css";
import "./styles/components.css";
import "./styles/from-app/connections.css";
import "./styles/from-app/connectionpanel.css";
import "./styles/from-app/terminaltabs.css";
import "./styles/from-app/terminalpanel.css";
import "./styles/from-app/filestabs.css";
import "./styles/from-app/filesmanager.css";
import "./styles/from-app/dashboardtabs.css";
import "./styles/from-app/dashboardpanel.css";
import "./styles/from-app/placespanel.css";
import "./styles/from-app/macrospanel.css";
import "./styles/from-app/local/localworkspace.css";
import "./styles/from-app/docker/docker.css";
import "./styles/from-app/logsworkspace.css";
import "./styles/from-app/dataworkspace.css";
import "./styles/from-app/settingspage.css";
import "./styles/from-app/agentpanel.css";
import "./styles/from-app/agentoutputlog.css";
import "./styles/from-app/agentexplainmodal.css";
import "./styles/from-app/developerailogs.css";
import "./styles/from-app/macroeditormodal.css";
import "./styles/from-app/macrorunmodal.css";
import "./styles/from-app/secretsmodal.css";
import "./styles/from-app/sshpasswordmodal.css";
import "./styles/from-app/contextmenu.css";
import "./styles/from-app/tooltip.css";
import "./styles/profile_editor.scss";
import "./styles/promo-modes.css";

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
