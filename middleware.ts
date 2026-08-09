import { createUnfurlMiddleware } from "./src/lib/unfurlMiddleware.js";

export const config = {
  matcher: ["/share/:token", "/watch/:publicId"],
};

export default createUnfurlMiddleware();
