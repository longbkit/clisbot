# Rà soát logo và branding Paseo còn lại trong Clisbot

Ngày kiểm tra: 2026-09-30. Đây là snapshot kiểm kê **trước khi thay nhận diện sản phẩm**.
Kết quả thay thế mới nằm ở [production-artifacts.md](production-artifacts.md).
Xem [mục lục và cách rà lại](README.md).

- Fusion worktree tại thời điểm kiểm tra: `/Volumes/Media/clisbot-worktrees/rebrand-clisbot` — `rebrand/clisbot-fusion-test`, commit `17566cab8`.
- Upstream đã rename: `/Volumes/Media/clisbot-worktrees/rebrand-upstream-v0.10.1` — `rebrand/upstream-v0.10.1-test`, commit `5b760da4e`.
- Đối chứng: `refs/upstream-releases/v0.10.1` (`2abbca32b`); phần Hub đối chiếu nhánh gốc `clisbot-paseoclaw-fusion`.

## Kết quả chính

- **40 file chứa nhận diện trực tiếp** ở Fusion: **34 asset** (24 PNG/ICO/ICNS + 10 SVG) và **6 file TSX** chứa nét vẽ logo. Nhánh upstream test có cùng 38 file; hai file Hub chỉ có ở Fusion.
- **34/34 asset logo giống từng byte với upstream Paseo v0.10.1**. Bốn TSX có đường vẽ bướm giống upstream; hai TSX của Hub vẫn vẽ chữ P từ bản Fusion gốc.
- **17 screenshot/preview sản phẩm** giữ nguyên upstream, gồm 14 ở website và 3 ở Fastlane. OCR tìm được tên/repo/path cũ trong **13/17** file. `og-image.png` có chữ Paseo nổi bật.
- **10 screenshot tài liệu plugin** cũng giữ nguyên upstream; OCR xác nhận 3 ảnh chứa Paseo. Ba ảnh `work/` là bằng chứng onboarding riêng của Fusion.
- **10 ảnh chân dung/testimonial** kế thừa upstream: 1 tác giả blog + 9 người được trích dẫn.
- Đã thống kê **147 file ảnh/video Git-tracked** của Fusion; **144/147** giống từng byte với tag upstream và giữa hai nhánh test. Ba file còn lại là ảnh onboarding trong `work/`, không có ở upstream.

Con số 147 gồm cả logo provider/editor, icon mẫu và bằng chứng E2E; không phải 147 file cần thay thương hiệu.

### Xem nhanh hình ảnh

- [Bảng icon app/desktop/favicon](images/01-icons.jpg)
- [Bảng screenshot và ảnh marketing](images/02-marketing.jpg)
- [Bảng screenshot tài liệu, E2E và icon mẫu](images/03-other-screenshots.jpg)

Số liệu và dòng tham chiếu bên dưới thuộc hai commit nêu trên; ảnh bằng chứng và concept mới trong folder audit này không được cộng vào baseline 147 file.

## 1. 40 file logo/nhận diện trực tiếp, chia theo folder

| Folder                                    |  Asset | TSX nhúng hình |   Tổng |
| ----------------------------------------- | -----: | -------------: | -----: |
| `packages/app/assets/images/`             |     19 |              0 |     19 |
| `packages/app/public/`                    |      3 |              0 |      3 |
| `packages/app/src/`                       |      0 |              2 |      2 |
| `packages/desktop/assets/`                |      8 |              0 |      8 |
| `packages/website/public/`                |      3 |              0 |      3 |
| `packages/website/src/components/mockup/` |      0 |              2 |      2 |
| `packages/hub/src/`                       |      0 |              2 |      2 |
| `fastlane/metadata/android/en-US/images/` |      1 |              0 |      1 |
| **Tổng**                                  | **34** |          **6** | **40** |

### 1.1. Logo nhúng trong code

| File, dòng định nghĩa hình                                                                                                     | Hiện trạng                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [packages/app/src/components/icons/clisbot-logo.tsx](../../../packages/app/src/components/icons/clisbot-logo.tsx#L16)          | ClisbotLogo: đường vẽ bướm Paseo; tên component đã đổi.                      |
| [packages/app/src/screens/startup-splash-screen.tsx](../../../packages/app/src/screens/startup-splash-screen.tsx#L101)         | Web splash có bản sao SVG trong CSS mask; thay component logo riêng chưa đủ. |
| [packages/website/src/components/mockup/icons.tsx](../../../packages/website/src/components/mockup/icons.tsx#L14)              | Logo trong sidebar mockup desktop.                                           |
| [packages/website/src/components/mockup/mobile/atoms.tsx](../../../packages/website/src/components/mockup/mobile/atoms.tsx#L8) | BUTTERFLY_D dùng cho ClisbotMark và ClisbotTile trong mockup mobile.         |
| [packages/hub/src/components/app/auth-layout.tsx](../../../packages/hub/src/components/app/auth-layout.tsx#L95)                | ClisbotGlyph vẫn vẽ chữ P; dùng trong ProductMark, đăng nhập và dashboard.   |
| [packages/hub/src/routes/\_\_root.tsx](../../../packages/hub/src/routes/__root.tsx#L17)                                        | Favicon inline data:image/svg+xml vẫn vẽ chữ P.                              |

### 1.2. Tất cả asset logo

| File                                                                                                                      | Kích thước | Dung lượng | Bằng chứng                        |
| ------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------: | --------------------------------- |
| [fastlane/metadata/android/en-US/images/icon.png](../../../fastlane/metadata/android/en-US/images/icon.png)               | 512x512    |   19,787 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/android-icon-foreground.png](../../../packages/app/assets/images/android-icon-foreground.png) | 1024x1024  |   18,551 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/butterfly-green.svg](../../../packages/app/assets/images/butterfly-green.svg)                 | SVG        |    3,296 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/butterfly-white.svg](../../../packages/app/assets/images/butterfly-white.svg)                 | SVG        |    3,294 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-dark-attention.png](../../../packages/app/assets/images/favicon-dark-attention.png)   | 48x48      |    2,169 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-dark-attention.svg](../../../packages/app/assets/images/favicon-dark-attention.svg)   | SVG        |    3,462 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-dark-running.png](../../../packages/app/assets/images/favicon-dark-running.png)       | 48x48      |    2,151 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-dark-running.svg](../../../packages/app/assets/images/favicon-dark-running.svg)       | SVG        |    3,462 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-dark.png](../../../packages/app/assets/images/favicon-dark.png)                       | 48x48      |    1,733 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-dark.svg](../../../packages/app/assets/images/favicon-dark.svg)                       | SVG        |    3,411 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-light-attention.png](../../../packages/app/assets/images/favicon-light-attention.png) | 48x48      |    2,169 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-light-attention.svg](../../../packages/app/assets/images/favicon-light-attention.svg) | SVG        |    3,462 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-light-running.png](../../../packages/app/assets/images/favicon-light-running.png)     | 48x48      |    2,151 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-light-running.svg](../../../packages/app/assets/images/favicon-light-running.svg)     | SVG        |    3,462 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-light.png](../../../packages/app/assets/images/favicon-light.png)                     | 48x48      |    1,733 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon-light.svg](../../../packages/app/assets/images/favicon-light.svg)                     | SVG        |    3,411 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/favicon.png](../../../packages/app/assets/images/favicon.png)                                 | 48x48      |    1,733 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/icon.png](../../../packages/app/assets/images/icon.png)                                       | 1024x1024  |   63,241 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/notification-icon.png](../../../packages/app/assets/images/notification-icon.png)             | 96x96      |    2,339 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/assets/images/splash-icon.png](../../../packages/app/assets/images/splash-icon.png)                         | 200x200    |    8,115 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/public/apple-touch-icon.png](../../../packages/app/public/apple-touch-icon.png)                             | 180x180    |    8,394 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/public/pwa-icon-192.png](../../../packages/app/public/pwa-icon-192.png)                                     | 192x192    |    9,214 B | Giống từng byte với Paseo v0.10.1 |
| [packages/app/public/pwa-icon-512.png](../../../packages/app/public/pwa-icon-512.png)                                     | 512x512    |   33,314 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/128x128.png](../../../packages/desktop/assets/128x128.png)                                       | 128x128    |    7,046 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/128x128@2x.png](../../../packages/desktop/assets/128x128@2x.png)                                 | 256x256    |   14,779 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/32x32.png](../../../packages/desktop/assets/32x32.png)                                           | 32x32      |    1,629 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/64x64.png](../../../packages/desktop/assets/64x64.png)                                           | 64x64      |    3,381 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/icon-dev.png](../../../packages/desktop/assets/icon-dev.png)                                     | 1254x1254  |  883,275 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/icon.icns](../../../packages/desktop/assets/icon.icns)                                           | 1024x1024  |  172,864 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/icon.ico](../../../packages/desktop/assets/icon.ico)                                             | 256x256    |   27,641 B | Giống từng byte với Paseo v0.10.1 |
| [packages/desktop/assets/icon.png](../../../packages/desktop/assets/icon.png)                                             | 512x512    |   32,164 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/favicon.ico](../../../packages/website/public/favicon.ico)                                       | 48x48      |   15,086 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/favicon.svg](../../../packages/website/public/favicon.svg)                                       | SVG        |    3,411 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/logo.svg](../../../packages/website/public/logo.svg)                                             | SVG        |    3,292 B | Giống từng byte với Paseo v0.10.1 |

Các file `butterfly-green.svg`, `butterfly-white.svg` và sáu favicon SVG không có tham chiếu trực tiếp từ code hiện tại qua tìm kiếm tên file. Vẫn nên quản lý như nguồn/biến thể logo; hook favicon runtime dùng sáu PNG. Các PNG theo độ phân giải ở desktop được cấu hình Linux dùng qua cả folder `assets`.

## 2. 17 screenshot/preview sản phẩm

| File                                                                                                                                    | Kích thước |  Dung lượng | Chữ cũ trong ảnh (OCR)                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------: | ----------------------------------------------------------------- |
| [fastlane/metadata/android/en-US/images/phoneScreenshots/1.png](../../../fastlane/metadata/android/en-US/images/phoneScreenshots/1.png) | 1206x2622  |   250,462 B | • getpaseo/paseo; boudra/konbert; boudra/moboudra.com             |
| [fastlane/metadata/android/en-US/images/phoneScreenshots/2.png](../../../fastlane/metadata/android/en-US/images/phoneScreenshots/2.png) | 1206x2622  |   319,749 B | = fix-138-number-k... getpaseo/pa...                              |
| [fastlane/metadata/android/en-US/images/phoneScreenshots/3.png](../../../fastlane/metadata/android/en-US/images/phoneScreenshots/3.png) | 1206x2622  |   430,733 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.   |
| [packages/website/public/hero-mockup.png](../../../packages/website/public/hero-mockup.png)                                             | 2048x1233  |   883,230 B | getpaseo/paseo; s boudra/shareavideo; Ppaseo-cloud                |
| [packages/website/public/homepage-hero.png](../../../packages/website/public/homepage-hero.png)                                         | 2400x1442  | 1,325,588 B | paseo • mac-dev; paseo • dev; paseo • dev                         |
| [packages/website/public/iphone-mockup-left.png](../../../packages/website/public/iphone-mockup-left.png)                               | 1857x3096  | 1,229,684 B | = main getpaseo/paseo; ~/dev/paseo main\*; > npm ls @getpaseo/cli |
| [packages/website/public/mobile-mockup.png](../../../packages/website/public/mobile-mockup.png)                                         | 2048x1239  |   605,749 B | &› getpaseo/paseo; [k boudra/konbert; boudra/moboudra.com         |
| [packages/website/public/og-image.png](../../../packages/website/public/og-image.png)                                                   | 1200x630   |   176,454 B | O getpaseo/paseo; boudra/moboudra.com; • boudra/faro              |
| [packages/website/public/phone-1-320.webp](../../../packages/website/public/phone-1-320.webp)                                           | 320x696    |    13,310 B | getpaseo/paseo; boudra/konbert; boudra/moboudra.com               |
| [packages/website/public/phone-1-480.webp](../../../packages/website/public/phone-1-480.webp)                                           | 480x1044   |    23,054 B | getpaseo/paseo; boudra/konbert; &boudra/moboudra.com              |
| [packages/website/public/phone-1.png](../../../packages/website/public/phone-1.png)                                                     | 1206x2622  |   250,462 B | • getpaseo/paseo; boudra/konbert; boudra/moboudra.com             |
| [packages/website/public/phone-2-320.webp](../../../packages/website/public/phone-2-320.webp)                                           | 320x696    |    22,992 B | fix-138-number-k... getpaseo/pa...                                |
| [packages/website/public/phone-2-480.webp](../../../packages/website/public/phone-2-480.webp)                                           | 480x1044   |    39,108 B | = fix-138-number-k... getpaseo/pa.../                             |
| [packages/website/public/phone-2.png](../../../packages/website/public/phone-2.png)                                                     | 1206x2622  |   319,749 B | = fix-138-number-k... getpaseo/pa...                              |
| [packages/website/public/phone-3-320.webp](../../../packages/website/public/phone-3-320.webp)                                           | 320x696    |    29,192 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.   |
| [packages/website/public/phone-3-480.webp](../../../packages/website/public/phone-3-480.webp)                                           | 480x1044   |    53,422 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.   |
| [packages/website/public/phone-3.png](../../../packages/website/public/phone-3.png)                                                     | 1206x2622  |   430,733 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.   |

README bốn ngôn ngữ tải `hero-mockup.png` và `mobile-mockup.png` từ `clisbot.com`; đổi URL không làm đổi chữ nằm trong ảnh. Website gắn `og-image.png` vào Open Graph/Twitter. `homepage-hero.png` là ảnh tham chiếu geometry của mockup. Một số ảnh phone/iphone cũ không còn được source hiện tại tham chiếu trực tiếp nhưng vẫn nằm trong public.

## 3. Screenshot tài liệu và bằng chứng

| File                                                                                                                                              | Kích thước | Dung lượng | Chữ cũ trong ảnh (OCR)                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------: | -------------------------------------------------------------------- |
| [plugin-examples/buttons/screenshots/actions.png](../../../plugin-examples/buttons/screenshots/actions.png)                                       | 1440x900   |   65,357 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [plugin-examples/buttons/screenshots/compact.png](../../../plugin-examples/buttons/screenshots/compact.png)                                       | 390x844    |   23,747 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [plugin-examples/buttons/screenshots/menu.png](../../../plugin-examples/buttons/screenshots/menu.png)                                             | 1440x900   |   73,382 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [plugin-examples/buttons/screenshots/popover.png](../../../plugin-examples/buttons/screenshots/popover.png)                                       | 1440x900   |   73,508 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [plugin-examples/modal-ui/screenshots/android-copy-paste.png](../../../plugin-examples/modal-ui/screenshots/android-copy-paste.png)               | 1080x1920  |   79,035 B | Paseo clipboard example; Copied from Paseo; Input: Copied from Paseo |
| [plugin-examples/modal-ui/screenshots/android-wide-custom-inset.png](../../../plugin-examples/modal-ui/screenshots/android-wide-custom-inset.png) | 1200x1600  |   70,900 B | Paseo clipboard example                                              |
| [plugin-examples/modal-ui/screenshots/web-custom-inset.png](../../../plugin-examples/modal-ui/screenshots/web-custom-inset.png)                   | 1200x900   |   53,973 B | Paseo clipboard example                                              |
| [plugin-examples/settings/screenshots/android.png](../../../plugin-examples/settings/screenshots/android.png)                                     | 1080x1920  |   75,487 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [plugin-examples/settings/screenshots/electron.png](../../../plugin-examples/settings/screenshots/electron.png)                                   | 1200x720   |   47,456 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [plugin-examples/settings/screenshots/web-compact.png](../../../plugin-examples/settings/screenshots/web-compact.png)                             | 390x844    |   20,680 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [work/hub-member-onboarding-mobile.png](../../../work/hub-member-onboarding-mobile.png)                                                           | 390x760    |   34,334 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [work/hub-member-onboarding.png](../../../work/hub-member-onboarding.png)                                                                         | 1100x820   |   58,630 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |
| [work/hub-owner-onboarding.png](../../../work/hub-owner-onboarding.png)                                                                           | 1100x820   |   54,281 B | OCR không thấy token cũ; không đồng nghĩa đã rebrand giao diện.      |

Ba ảnh `plugin-examples/modal-ui/screenshots/` còn rõ `Paseo clipboard example`; ảnh Android copy/paste còn `Copied from Paseo`. Các ảnh tài liệu khác cần xem như một bộ khi chụp lại. Ảnh `work/` không nằm trong tài sản phát hành; có thể giữ như bằng chứng lịch sử.

## 4. Branding văn bản, tác giả, testimonial và liên kết cần xem riêng

| File                                                                                                                     | Hiện trạng / việc cần quyết định                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/website/src/components/legal-page.tsx](../../../packages/website/src/components/legal-page.tsx#L27)            | Đang ghi “Mohamed Boudra Ziani, operating as Clisbot”, giữ nguyên địa chỉ, VAT và email upstream. Đây là nội dung danh tính vận hành chưa phù hợp với rebrand; cần thông tin Clisbot trước khi publish. |
| [packages/website/src/routes/privacy.tsx](../../../packages/website/src/routes/privacy.tsx#L29)                          | Vẫn ghi Mohamed Boudra Ziani là data controller; có email hello@moboudra.com.                                                                                                                           |
| [packages/website/src/routes/terms.tsx](../../../packages/website/src/routes/terms.tsx#L19)                              | Gắn tên Clisbot với dịch vụ relay/hub upstream và email của tác giả cũ. Endpoint test được phép giữ, nội dung trang vận hành cần xử lý riêng.                                                           |
| [packages/website/src/components/landing-page.tsx](../../../packages/website/src/components/landing-page.tsx#L164)       | 9 testimonial upstream; hai quote ở dòng 228 và 236 đã bị rename Paseo → Clisbot. Git tag xác nhận bản gốc nói Paseo. Không nên trình bày chúng như đánh giá dành cho Clisbot.                          |
| [packages/website/src/components/landing-page.tsx](../../../packages/website/src/components/landing-page.tsx#L824)       | Community plugins đã thành clisbot.cafe do replace chữ; cần xác nhận URL do Clisbot quản lý trước khi dùng.                                                                                             |
| [packages/website/src/routes/blog/$.tsx](../../../packages/website/src/routes/blog/$.tsx#L49)                            | Mọi bài blog vẫn mang byline Mo Boudra, ảnh và tài khoản X upstream. Nếu giữ bài gốc, cần thể hiện nguồn; không chỉ đổi tác giả.                                                                        |
| [packages/website/posts/i-was-wrong-about-electron.md](../../../packages/website/posts/i-was-wrong-about-electron.md#L8) | Câu chuyện ngôi thứ nhất của upstream đã thành “When I started building Clisbot…”. Cần quyết định giữ với attribution hay bỏ khỏi blog sản phẩm.                                                        |
| [packages/website/posts/hello-world.md](../../../packages/website/posts/hello-world.md#L2)                               | Bài mở blog và ngày tháng của upstream đã được đổi thành Clisbot.                                                                                                                                       |
| [packages/website/posts/drafts/draft-example.md](../../../packages/website/posts/drafts/draft-example.md#L1)             | Bài mẫu draft kế thừa; không có dấu Paseo cần replace, cân nhắc khi dọn blog.                                                                                                                           |
| [packages/website/src/routes/hub.tsx](../../../packages/website/src/routes/hub.tsx#L265)                                 | Demo còn tác giả moboudra (dòng 265/283), link getpaseo/hub (548), logo website và hosted Hub upstream.                                                                                                 |
| [packages/website/src/downloads.tsx](../../../packages/website/src/downloads.tsx#L30)                                    | App Store URL chỉ đổi slug nhưng giữ ID upstream 6758887924; Google Play package được rename thành sh.clisbot. Chưa xác minh listing Clisbot thực tế.                                                   |
| [packages/app/eas.json](../../../packages/app/eas.json#L39)                                                              | submit.production.ios.ascAppId vẫn là 6758887924, cùng giá trị upstream; khác với Expo owner/project ID đã cấu hình.                                                                                    |

### 10 ảnh đi kèm tác giả/testimonial

| File                                                                                                                          | Kích thước | Dung lượng | Bằng chứng                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------: | --------------------------------- |
| [packages/website/public/9viSwGkz_400x400.jpg](../../../packages/website/public/9viSwGkz_400x400.jpg)                         | 400x400    |   45,537 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/aadtyn.jpg](../../../packages/website/public/social-proof/aadtyn.jpg)                   | 73x73      |    2,795 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/amankumarjagdev.jpg](../../../packages/website/public/social-proof/amankumarjagdev.jpg) | 73x73      |    2,439 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/arnoldgamboa.jpg](../../../packages/website/public/social-proof/arnoldgamboa.jpg)       | 73x73      |    3,329 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/bevstratov.jpg](../../../packages/website/public/social-proof/bevstratov.jpg)           | 73x73      |    2,083 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/ceeebeeebeee.jpg](../../../packages/website/public/social-proof/ceeebeeebeee.jpg)       | 73x73      |    2,795 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/dongnaebi.jpg](../../../packages/website/public/social-proof/dongnaebi.jpg)             | 73x73      |    3,507 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/erikksherman.jpg](../../../packages/website/public/social-proof/erikksherman.jpg)       | 73x73      |    2,973 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/jasontorres.jpg](../../../packages/website/public/social-proof/jasontorres.jpg)         | 73x73      |    3,863 B | Giống từng byte với Paseo v0.10.1 |
| [packages/website/public/social-proof/tietougongshiba.jpg](../../../packages/website/public/social-proof/tietougongshiba.jpg) | 73x73      |    2,795 B | Giống từng byte với Paseo v0.10.1 |

## 5. File cấu hình và nơi sử dụng logo/ảnh

Các file dưới đây cần kiểm tra khi thay asset; nhiều nơi sẽ tự cập nhật nếu giữ nguyên đường dẫn. Đây không phải số file chắc chắn phải sửa.

| File                                                                                                                                        | Dòng tham chiếu         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [README.ja.md](../../../README.ja.md#L2)                                                                                                    | 2, 31, 35               |
| [README.ko.md](../../../README.ko.md#L2)                                                                                                    | 2, 31, 35               |
| [README.md](../../../README.md#L2)                                                                                                          | 2, 31, 35               |
| [README.zh-CN.md](../../../README.zh-CN.md#L2)                                                                                              | 2, 31, 35               |
| [packages/app/app.config.js](../../../packages/app/app.config.js#L70)                                                                       | 70, 127, 146, 176       |
| [packages/app/e2e/mobile/clipboard-image.mjs](../../../packages/app/e2e/mobile/clipboard-image.mjs#L16)                                     | 16                      |
| [packages/app/public/index.html](../../../packages/app/public/index.html#L16)                                                               | 16                      |
| [packages/app/public/manifest.json](../../../packages/app/public/manifest.json#L15)                                                         | 15, 21                  |
| [packages/app/src/components/welcome-screen.tsx](../../../packages/app/src/components/welcome-screen.tsx#L28)                               | 28, 317                 |
| [packages/app/src/hooks/use-favicon-status.ts](../../../packages/app/src/hooks/use-favicon-status.ts#L15)                                   | 15, 16, 17, 20, 21, 22  |
| [packages/app/src/screens/open-project-screen.tsx](../../../packages/app/src/screens/open-project-screen.tsx#L8)                            | 8, 73                   |
| [packages/app/src/utils/os-notifications.test.ts](../../../packages/app/src/utils/os-notifications.test.ts#L55)                             | 55                      |
| [packages/app/src/utils/os-notifications.ts](../../../packages/app/src/utils/os-notifications.ts#L112)                                      | 112                     |
| [packages/app/src/utils/tool-call-icon.ts](../../../packages/app/src/utils/tool-call-icon.ts#L14)                                           | 14, 29                  |
| [packages/desktop/electron-builder.yml](../../../packages/desktop/electron-builder.yml#L42)                                                 | 42, 84                  |
| [packages/desktop/src/features/notifications.ts](../../../packages/desktop/src/features/notifications.ts#L34)                               | 34                      |
| [packages/desktop/src/main.ts](../../../packages/desktop/src/main.ts#L599)                                                                  | 599, 600, 601, 605, 606 |
| [packages/hub/README.md](../../../packages/hub/README.md#L2)                                                                                | 2                       |
| [packages/hub/src/auth/account-states.tsx](../../../packages/hub/src/auth/account-states.tsx#L2)                                            | 2, 34                   |
| [packages/hub/src/auth/dashboard-shell.tsx](../../../packages/hub/src/auth/dashboard-shell.tsx#L37)                                         | 37, 636                 |
| [packages/website/src/components/mockup/geometry.ts](../../../packages/website/src/components/mockup/geometry.ts#L7)                        | 7                       |
| [packages/website/src/components/mockup/mobile/sidebar.tsx](../../../packages/website/src/components/mockup/mobile/sidebar.tsx#L24)         | 24, 65, 69              |
| [packages/website/src/components/mockup/sidebar.tsx](../../../packages/website/src/components/mockup/sidebar.tsx#L22)                       | 22, 172                 |
| [packages/website/src/components/site-header.tsx](../../../packages/website/src/components/site-header.tsx#L10)                             | 10                      |
| [packages/website/src/content/alternatives/claude-desktop.md](../../../packages/website/src/content/alternatives/claude-desktop.md#L14)     | 14                      |
| [packages/website/src/content/alternatives/codex-app.md](../../../packages/website/src/content/alternatives/codex-app.md#L14)               | 14                      |
| [packages/website/src/content/alternatives/conductor.md](../../../packages/website/src/content/alternatives/conductor.md#L14)               | 14                      |
| [packages/website/src/content/alternatives/happy-coder.md](../../../packages/website/src/content/alternatives/happy-coder.md#L14)           | 14                      |
| [packages/website/src/content/alternatives/openchamber.md](../../../packages/website/src/content/alternatives/openchamber.md#L14)           | 14                      |
| [packages/website/src/content/alternatives/opencode-desktop.md](../../../packages/website/src/content/alternatives/opencode-desktop.md#L14) | 14                      |
| [packages/website/src/content/alternatives/superset.md](../../../packages/website/src/content/alternatives/superset.md#L14)                 | 14                      |
| [packages/website/src/routes/\_\_root.tsx](../../../packages/website/src/routes/__root.tsx#L65)                                             | 65, 67                  |
| [packages/website/src/routes/docs.tsx](../../../packages/website/src/routes/docs.tsx#L31)                                                   | 31, 55                  |
| [packages/website/src/routes/hub.tsx](../../../packages/website/src/routes/hub.tsx#L334)                                                    | 334                     |

Bổ sung: `packages/app/app.config.js:160` cấu hình favicon; `packages/website/src/routes/__root.tsx:70` cấu hình favicon/apple-touch; `packages/desktop/electron-builder.yml:57` dùng thư mục icon Linux.

### File hỗ trợ quy trình và phần đã đổi đúng

- [scripts/rebrand-clisbot.mjs](../../../scripts/rebrand-clisbot.mjs): script chỉ đổi tên/text và template; bỏ qua binary, không thay nét SVG. Chưa có bước sinh bộ logo mới.
- [scripts/rebrand-clisbot.test.mjs](../../../scripts/rebrand-clisbot.test.mjs): kiểm tra rename text/path; không xác nhận nhận diện trong ảnh.
- [docs/guides/developer-guide/upstream-sync-and-contribution.md](../../../docs/guides/developer-guide/upstream-sync-and-contribution.md#L160): đã ghi binary bị bỏ qua; `--check` chỉ xác nhận chạy lại không tạo diff.
- [packages/website/src/components/sponsorship.tsx](../../../packages/website/src/components/sponsorship.tsx), [packages/website/src/data/sponsors.ts](../../../packages/website/src/data/sponsors.ts), [packages/website/src/routes/sponsor.tsx](../../../packages/website/src/routes/sponsor.tsx): sponsor hiện là placeholder; chưa có logo sponsor cần thay.
- [packages/website/src/components/site-header.tsx](../../../packages/website/src/components/site-header.tsx) và [packages/website/src/components/site-footer.tsx](../../../packages/website/src/components/site-footer.tsx): community đã về Discord Clisbot.
- [fastlane/metadata/android/en-US/title.txt](../../../fastlane/metadata/android/en-US/title.txt), [fastlane/metadata/android/en-US/short_description.txt](../../../fastlane/metadata/android/en-US/short_description.txt), [fastlane/metadata/android/en-US/full_description.txt](../../../fastlane/metadata/android/en-US/full_description.txt): text metadata đã rebrand; icon/screenshot chưa thay.
- [packages/website/src/components/butterfly.tsx](../../../packages/website/src/components/butterfly.tsx) và [packages/website/src/styles.css](../../../packages/website/src/styles.css): hiệu ứng bướm/palette website kế thừa, là phần visual design có thể xem lại; không phải cùng đường vẽ logo.

## 6. Phạm vi, dòng ảnh hưởng và hướng xử lý

- Dòng code chứa geometry được chỉ rõ ở bảng 1.1; 10 SVG có nét vẽ trong file. Với 24 binary logo, không có số dòng sửa có ý nghĩa: cần thay file ảnh. Báo cáo ghi kích thước/dung lượng thay vì gán số dòng giả.
- Số dòng diff thực tế chỉ có sau khi chốt logo và cách sinh asset. File sử dụng asset không nhất thiết phải sửa nếu giữ tên file.
- Đề xuất lưu logo Clisbot gốc + cấu hình sinh PNG/ICO/ICNS/favicon/splash trong phần rebrand, áp dụng cùng một bước cho cả hai nhánh. Giữ đường dẫn asset upstream giúp giảm thay đổi code tiêu thụ.
- Các SVG nhúng ở app, web splash, website mockup và Hub cần thay đồng bộ; ảnh screenshot nên chụp lại từ UI Clisbot.
- Attribution Paseo/OpenClaw và LICENSE là phần giữ nguồn có chủ đích, không gộp vào lỗi logo. Logo Claude/Codex/provider/editor/channel là của tích hợp tương ứng, không đổi thành logo Clisbot.
- Phạm vi là file Git-tracked; không đánh giá bản app đã cài, cache, dist/node_modules, native build sinh ra, hay GitHub social preview cấu hình trên web.
- Chưa kiểm tra domain, App Store/Play Store hay ảnh đang được host thực tế. Các kết luận URL ở trên chỉ dựa trên source và Git history.
- Đã xem bảng ảnh và OCR 44 raster image liên quan. OCR có thể bỏ sót; không đọc hết mọi frame của video E2E. Toàn bộ video được liệt kê trong phụ lục.

## Phụ lục: toàn bộ 147 file ảnh/video đã kiểm kê

| Nhóm                                   | Số file |
| -------------------------------------- | ------: |
| Logo/icon trực tiếp                    |      34 |
| Screenshot/preview sản phẩm            |      17 |
| Icon provider/editor/plugin bên thứ ba |      55 |
| Bằng chứng/fixture E2E                 |       8 |
| Icon mẫu Expo, không phải Paseo        |       8 |
| Ảnh tác giả/testimonial upstream       |      10 |
| Trang trí website                      |       2 |
| Screenshot tài liệu plugin             |      10 |
| Ảnh onboarding Hub nội bộ              |       3 |

| File                                                                                                                                                            | Nhóm                                   | Giống tag upstream |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------ |
| [fastlane/metadata/android/en-US/images/icon.png](../../../fastlane/metadata/android/en-US/images/icon.png)                                                     | Logo/icon trực tiếp                    | Có                 |
| [fastlane/metadata/android/en-US/images/phoneScreenshots/1.png](../../../fastlane/metadata/android/en-US/images/phoneScreenshots/1.png)                         | Screenshot/preview sản phẩm            | Có                 |
| [fastlane/metadata/android/en-US/images/phoneScreenshots/2.png](../../../fastlane/metadata/android/en-US/images/phoneScreenshots/2.png)                         | Screenshot/preview sản phẩm            | Có                 |
| [fastlane/metadata/android/en-US/images/phoneScreenshots/3.png](../../../fastlane/metadata/android/en-US/images/phoneScreenshots/3.png)                         | Screenshot/preview sản phẩm            | Có                 |
| [packages/app/assets/icons/claude.svg](../../../packages/app/assets/icons/claude.svg)                                                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/icons/codex.svg](../../../packages/app/assets/icons/codex.svg)                                                                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/android-icon-foreground.png](../../../packages/app/assets/images/android-icon-foreground.png)                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/butterfly-green.svg](../../../packages/app/assets/images/butterfly-green.svg)                                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/butterfly-white.svg](../../../packages/app/assets/images/butterfly-white.svg)                                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/editor-apps/antigravity.png](../../../packages/app/assets/images/editor-apps/antigravity.png)                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/editor-apps/cursor.png](../../../packages/app/assets/images/editor-apps/cursor.png)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/editor-apps/file-explorer.png](../../../packages/app/assets/images/editor-apps/file-explorer.png)                                   | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/editor-apps/finder.png](../../../packages/app/assets/images/editor-apps/finder.png)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/editor-apps/vscode.png](../../../packages/app/assets/images/editor-apps/vscode.png)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/editor-apps/webstorm.png](../../../packages/app/assets/images/editor-apps/webstorm.png)                                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/editor-apps/zed.png](../../../packages/app/assets/images/editor-apps/zed.png)                                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/assets/images/favicon-dark-attention.png](../../../packages/app/assets/images/favicon-dark-attention.png)                                         | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-dark-attention.svg](../../../packages/app/assets/images/favicon-dark-attention.svg)                                         | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-dark-running.png](../../../packages/app/assets/images/favicon-dark-running.png)                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-dark-running.svg](../../../packages/app/assets/images/favicon-dark-running.svg)                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-dark.png](../../../packages/app/assets/images/favicon-dark.png)                                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-dark.svg](../../../packages/app/assets/images/favicon-dark.svg)                                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-light-attention.png](../../../packages/app/assets/images/favicon-light-attention.png)                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-light-attention.svg](../../../packages/app/assets/images/favicon-light-attention.svg)                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-light-running.png](../../../packages/app/assets/images/favicon-light-running.png)                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-light-running.svg](../../../packages/app/assets/images/favicon-light-running.svg)                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-light.png](../../../packages/app/assets/images/favicon-light.png)                                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon-light.svg](../../../packages/app/assets/images/favicon-light.svg)                                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/favicon.png](../../../packages/app/assets/images/favicon.png)                                                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/icon.png](../../../packages/app/assets/images/icon.png)                                                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/notification-icon.png](../../../packages/app/assets/images/notification-icon.png)                                                   | Logo/icon trực tiếp                    | Có                 |
| [packages/app/assets/images/splash-icon.png](../../../packages/app/assets/images/splash-icon.png)                                                               | Logo/icon trực tiếp                    | Có                 |
| [packages/app/e2e/mobile/diff-tree/evidence/after.png](../../../packages/app/e2e/mobile/diff-tree/evidence/after.png)                                           | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/mobile/diff-tree/evidence/before.png](../../../packages/app/e2e/mobile/diff-tree/evidence/before.png)                                         | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/mobile/diff-tree/evidence/dark.png](../../../packages/app/e2e/mobile/diff-tree/evidence/dark.png)                                             | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/mobile/diff-tree/evidence/light.png](../../../packages/app/e2e/mobile/diff-tree/evidence/light.png)                                           | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/mobile/modal-sheet/evidence/android-after.mp4](../../../packages/app/e2e/mobile/modal-sheet/evidence/android-after.mp4)                       | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/mobile/modal-sheet/evidence/android-before.mp4](../../../packages/app/e2e/mobile/modal-sheet/evidence/android-before.mp4)                     | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/mobile/modal-sheet/evidence/browser.webm](../../../packages/app/e2e/mobile/modal-sheet/evidence/browser.webm)                                 | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/e2e/support/fixtures/recording.webm](../../../packages/app/e2e/support/fixtures/recording.webm)                                                   | Bằng chứng/fixture E2E                 | Có                 |
| [packages/app/public/apple-touch-icon.png](../../../packages/app/public/apple-touch-icon.png)                                                                   | Logo/icon trực tiếp                    | Có                 |
| [packages/app/public/pwa-icon-192.png](../../../packages/app/public/pwa-icon-192.png)                                                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/app/public/pwa-icon-512.png](../../../packages/app/public/pwa-icon-512.png)                                                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/app/src/assets/acp-provider-icons/agoragentic-acp.svg](../../../packages/app/src/assets/acp-provider-icons/agoragentic-acp.svg)                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/amp-acp.svg](../../../packages/app/src/assets/acp-provider-icons/amp-acp.svg)                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/auggie.svg](../../../packages/app/src/assets/acp-provider-icons/auggie.svg)                                         | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/autohand.svg](../../../packages/app/src/assets/acp-provider-icons/autohand.svg)                                     | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/claude-acp.svg](../../../packages/app/src/assets/acp-provider-icons/claude-acp.svg)                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/cline.svg](../../../packages/app/src/assets/acp-provider-icons/cline.svg)                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/codebuddy-code.svg](../../../packages/app/src/assets/acp-provider-icons/codebuddy-code.svg)                         | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/codewhale.svg](../../../packages/app/src/assets/acp-provider-icons/codewhale.svg)                                   | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/codex-acp.svg](../../../packages/app/src/assets/acp-provider-icons/codex-acp.svg)                                   | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/cortex-code.svg](../../../packages/app/src/assets/acp-provider-icons/cortex-code.svg)                               | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/corust-agent.svg](../../../packages/app/src/assets/acp-provider-icons/corust-agent.svg)                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/crow-cli.svg](../../../packages/app/src/assets/acp-provider-icons/crow-cli.svg)                                     | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/cursor.svg](../../../packages/app/src/assets/acp-provider-icons/cursor.svg)                                         | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/deepagents.svg](../../../packages/app/src/assets/acp-provider-icons/deepagents.svg)                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/dimcode.svg](../../../packages/app/src/assets/acp-provider-icons/dimcode.svg)                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/dirac.svg](../../../packages/app/src/assets/acp-provider-icons/dirac.svg)                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/factory-droid.svg](../../../packages/app/src/assets/acp-provider-icons/factory-droid.svg)                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/fast-agent.svg](../../../packages/app/src/assets/acp-provider-icons/fast-agent.svg)                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/gemini.svg](../../../packages/app/src/assets/acp-provider-icons/gemini.svg)                                         | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/github-copilot-cli.svg](../../../packages/app/src/assets/acp-provider-icons/github-copilot-cli.svg)                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/gjc.svg](../../../packages/app/src/assets/acp-provider-icons/gjc.svg)                                               | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/glm-acp-agent.svg](../../../packages/app/src/assets/acp-provider-icons/glm-acp-agent.svg)                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/goose.svg](../../../packages/app/src/assets/acp-provider-icons/goose.svg)                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/junie.svg](../../../packages/app/src/assets/acp-provider-icons/junie.svg)                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/kilo.svg](../../../packages/app/src/assets/acp-provider-icons/kilo.svg)                                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/kimi.svg](../../../packages/app/src/assets/acp-provider-icons/kimi.svg)                                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/minion-code.svg](../../../packages/app/src/assets/acp-provider-icons/minion-code.svg)                               | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/mistral-vibe.svg](../../../packages/app/src/assets/acp-provider-icons/mistral-vibe.svg)                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/nova.svg](../../../packages/app/src/assets/acp-provider-icons/nova.svg)                                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/opencode.svg](../../../packages/app/src/assets/acp-provider-icons/opencode.svg)                                     | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/pi-acp.svg](../../../packages/app/src/assets/acp-provider-icons/pi-acp.svg)                                         | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/poolside.svg](../../../packages/app/src/assets/acp-provider-icons/poolside.svg)                                     | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/qoder.svg](../../../packages/app/src/assets/acp-provider-icons/qoder.svg)                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/qwen-code.svg](../../../packages/app/src/assets/acp-provider-icons/qwen-code.svg)                                   | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/sigit.svg](../../../packages/app/src/assets/acp-provider-icons/sigit.svg)                                           | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/stakpak.svg](../../../packages/app/src/assets/acp-provider-icons/stakpak.svg)                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/app/src/assets/acp-provider-icons/vtcode.svg](../../../packages/app/src/assets/acp-provider-icons/vtcode.svg)                                         | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/128x128.png](../../../packages/desktop/assets/128x128.png)                                                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/128x128@2x.png](../../../packages/desktop/assets/128x128@2x.png)                                                                       | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/32x32.png](../../../packages/desktop/assets/32x32.png)                                                                                 | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/64x64.png](../../../packages/desktop/assets/64x64.png)                                                                                 | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/editor-targets/android-studio.png](../../../packages/desktop/assets/editor-targets/android-studio.png)                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/editor-targets/antigravity.png](../../../packages/desktop/assets/editor-targets/antigravity.png)                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/editor-targets/cursor.png](../../../packages/desktop/assets/editor-targets/cursor.png)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/editor-targets/finder.png](../../../packages/desktop/assets/editor-targets/finder.png)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/editor-targets/vscode.png](../../../packages/desktop/assets/editor-targets/vscode.png)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/editor-targets/webstorm.png](../../../packages/desktop/assets/editor-targets/webstorm.png)                                             | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/editor-targets/zed.png](../../../packages/desktop/assets/editor-targets/zed.png)                                                       | Icon provider/editor/plugin bên thứ ba | Có                 |
| [packages/desktop/assets/icon-dev.png](../../../packages/desktop/assets/icon-dev.png)                                                                           | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/icon.icns](../../../packages/desktop/assets/icon.icns)                                                                                 | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/icon.ico](../../../packages/desktop/assets/icon.ico)                                                                                   | Logo/icon trực tiếp                    | Có                 |
| [packages/desktop/assets/icon.png](../../../packages/desktop/assets/icon.png)                                                                                   | Logo/icon trực tiếp                    | Có                 |
| [packages/expo-two-way-audio/examples/basic-usage/assets/adaptive-icon.png](../../../packages/expo-two-way-audio/examples/basic-usage/assets/adaptive-icon.png) | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/basic-usage/assets/favicon.png](../../../packages/expo-two-way-audio/examples/basic-usage/assets/favicon.png)             | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/basic-usage/assets/icon.png](../../../packages/expo-two-way-audio/examples/basic-usage/assets/icon.png)                   | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/basic-usage/assets/splash.png](../../../packages/expo-two-way-audio/examples/basic-usage/assets/splash.png)               | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/flow-api/assets/adaptive-icon.png](../../../packages/expo-two-way-audio/examples/flow-api/assets/adaptive-icon.png)       | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/flow-api/assets/favicon.png](../../../packages/expo-two-way-audio/examples/flow-api/assets/favicon.png)                   | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/flow-api/assets/icon.png](../../../packages/expo-two-way-audio/examples/flow-api/assets/icon.png)                         | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/expo-two-way-audio/examples/flow-api/assets/splash.png](../../../packages/expo-two-way-audio/examples/flow-api/assets/splash.png)                     | Icon mẫu Expo, không phải Paseo        | Có                 |
| [packages/website/public/9viSwGkz_400x400.jpg](../../../packages/website/public/9viSwGkz_400x400.jpg)                                                           | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/blank-page.svg](../../../packages/website/public/blank-page.svg)                                                                       | Trang trí website                      | Có                 |
| [packages/website/public/favicon.ico](../../../packages/website/public/favicon.ico)                                                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/website/public/favicon.svg](../../../packages/website/public/favicon.svg)                                                                             | Logo/icon trực tiếp                    | Có                 |
| [packages/website/public/hero-bg.jpg](../../../packages/website/public/hero-bg.jpg)                                                                             | Trang trí website                      | Có                 |
| [packages/website/public/hero-mockup.png](../../../packages/website/public/hero-mockup.png)                                                                     | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/homepage-hero.png](../../../packages/website/public/homepage-hero.png)                                                                 | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/iphone-mockup-left.png](../../../packages/website/public/iphone-mockup-left.png)                                                       | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/logo.svg](../../../packages/website/public/logo.svg)                                                                                   | Logo/icon trực tiếp                    | Có                 |
| [packages/website/public/mobile-mockup.png](../../../packages/website/public/mobile-mockup.png)                                                                 | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/og-image.png](../../../packages/website/public/og-image.png)                                                                           | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-1-320.webp](../../../packages/website/public/phone-1-320.webp)                                                                   | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-1-480.webp](../../../packages/website/public/phone-1-480.webp)                                                                   | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-1.png](../../../packages/website/public/phone-1.png)                                                                             | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-2-320.webp](../../../packages/website/public/phone-2-320.webp)                                                                   | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-2-480.webp](../../../packages/website/public/phone-2-480.webp)                                                                   | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-2.png](../../../packages/website/public/phone-2.png)                                                                             | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-3-320.webp](../../../packages/website/public/phone-3-320.webp)                                                                   | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-3-480.webp](../../../packages/website/public/phone-3-480.webp)                                                                   | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/phone-3.png](../../../packages/website/public/phone-3.png)                                                                             | Screenshot/preview sản phẩm            | Có                 |
| [packages/website/public/social-proof/aadtyn.jpg](../../../packages/website/public/social-proof/aadtyn.jpg)                                                     | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/amankumarjagdev.jpg](../../../packages/website/public/social-proof/amankumarjagdev.jpg)                                   | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/arnoldgamboa.jpg](../../../packages/website/public/social-proof/arnoldgamboa.jpg)                                         | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/bevstratov.jpg](../../../packages/website/public/social-proof/bevstratov.jpg)                                             | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/ceeebeeebeee.jpg](../../../packages/website/public/social-proof/ceeebeeebeee.jpg)                                         | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/dongnaebi.jpg](../../../packages/website/public/social-proof/dongnaebi.jpg)                                               | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/erikksherman.jpg](../../../packages/website/public/social-proof/erikksherman.jpg)                                         | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/jasontorres.jpg](../../../packages/website/public/social-proof/jasontorres.jpg)                                           | Ảnh tác giả/testimonial upstream       | Có                 |
| [packages/website/public/social-proof/tietougongshiba.jpg](../../../packages/website/public/social-proof/tietougongshiba.jpg)                                   | Ảnh tác giả/testimonial upstream       | Có                 |
| [plugin-examples/buttons/screenshots/actions.png](../../../plugin-examples/buttons/screenshots/actions.png)                                                     | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/buttons/screenshots/compact.png](../../../plugin-examples/buttons/screenshots/compact.png)                                                     | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/buttons/screenshots/menu.png](../../../plugin-examples/buttons/screenshots/menu.png)                                                           | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/buttons/screenshots/popover.png](../../../plugin-examples/buttons/screenshots/popover.png)                                                     | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/modal-ui/screenshots/android-copy-paste.png](../../../plugin-examples/modal-ui/screenshots/android-copy-paste.png)                             | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/modal-ui/screenshots/android-wide-custom-inset.png](../../../plugin-examples/modal-ui/screenshots/android-wide-custom-inset.png)               | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/modal-ui/screenshots/web-custom-inset.png](../../../plugin-examples/modal-ui/screenshots/web-custom-inset.png)                                 | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/provider-acp-transformer/icon.svg](../../../plugin-examples/provider-acp-transformer/icon.svg)                                                 | Icon provider/editor/plugin bên thứ ba | Có                 |
| [plugin-examples/provider-direct/icon.svg](../../../plugin-examples/provider-direct/icon.svg)                                                                   | Icon provider/editor/plugin bên thứ ba | Có                 |
| [plugin-examples/settings/screenshots/android.png](../../../plugin-examples/settings/screenshots/android.png)                                                   | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/settings/screenshots/electron.png](../../../plugin-examples/settings/screenshots/electron.png)                                                 | Screenshot tài liệu plugin             | Có                 |
| [plugin-examples/settings/screenshots/web-compact.png](../../../plugin-examples/settings/screenshots/web-compact.png)                                           | Screenshot tài liệu plugin             | Có                 |
| [work/hub-member-onboarding-mobile.png](../../../work/hub-member-onboarding-mobile.png)                                                                         | Ảnh onboarding Hub nội bộ              | Không có ở tag     |
| [work/hub-member-onboarding.png](../../../work/hub-member-onboarding.png)                                                                                       | Ảnh onboarding Hub nội bộ              | Không có ở tag     |
| [work/hub-owner-onboarding.png](../../../work/hub-owner-onboarding.png)                                                                                         | Ảnh onboarding Hub nội bộ              | Không có ở tag     |
