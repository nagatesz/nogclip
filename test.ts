import { Innertube } from "youtubei.js";
(async () => {
    try {
        const yt = await Innertube.create({ generate_session_locally: true });
        const info = await yt.getBasicInfo("jNQXAC9IVRw", "IOS");
        const format = info.chooseFormat({ type: "video+audio", quality: "best" });
        console.log("Success URL:", format?.url);
    } catch(e) {
        console.error(e);
    }
})();
