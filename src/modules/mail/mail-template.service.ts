import { env } from '../../config/env';

export type MailTemplateKey =
  | 'application_submitted'
  | 'application_resubmitted'
  | 'supplement_requested'
  | 'supplement_deadline_reminder'
  | 'application_status_updated'
  | 'application_rejected'
  | 'application_result_announced';

export type RenderMailTemplateInput = {
  templateKey: MailTemplateKey;
  payload: Record<string, unknown>;
};

export type RenderedMailTemplate = {
  subject: string;
  html: string;
  text: string;
};

type NormalizedMailPayload = {
  studentName: string;
  applicationCode: string;
  schoolYear?: string;
  targetLevel: string;
  finalLevel: string;
  criterionName: string;
  supplementSummary: string;
  reason: string;
  reviewNote: string;
  finalNote: string;
  deadline: string;
  statusLabel: string;
  statusMessage: string;
  applicationUrl: string;
  supplementUrl: string;
  resultUrl: string;
  supportEmail?: string;
  websiteUrl?: string;
  logoUrl?: string;
  finalStatus?: string;
  reminderWindow?: string;
  context?: string;
};

type OfficialEmailLayoutInput = {
  subject: string;
  studentName: string;
  openingParagraph: string;
  mainAnnouncement: string;
  subAnnouncement?: string;
  bodyBlocks: string[];
  actionLabel?: string;
  actionUrl?: string;
  actionPrefix?: string;
  note?: string;
  supportEmail?: string;
  websiteUrl?: string;
  logoUrl?: string;
  showGoodDayWish?: boolean;
  extraClosingSentence?: string;
};

const organizationName = 'Hội Sinh viên Trường Đại học Bách khoa - ĐHĐN';
const organizationNameUpper = 'HỘI SINH VIÊN TRƯỜNG ĐẠI HỌC BÁCH KHOA - ĐHĐN';
const systemName = 'Hệ thống 5TOT';
const defaultDetailMessage = 'Vui lòng xem chi tiết trên hệ thống 5TOT.';
const defaultSupplementSummary =
  'Vui lòng xem nội dung yêu cầu bổ sung trên hệ thống 5TOT.';
const defaultDeadline = 'Theo thông báo trên hệ thống';
const defaultTargetLevel = 'theo cấp xét đã đăng ký';
const defaultCriterionName = 'tiêu chí liên quan';
const commonSupportSentence =
  'Mọi thắc mắc vui lòng liên hệ Hội Sinh viên Trường hoặc cán bộ phụ trách để được hỗ trợ.';

export class MailTemplateService {
  render(input: RenderMailTemplateInput): RenderedMailTemplate {
    const data = normalizePayload(input.payload);

    if (input.templateKey === 'application_submitted') {
      return renderOfficialEmailLayout({
        subject: `${subjectPrefix(data.schoolYear)} XÁC NHẬN TIẾP NHẬN HỒ SƠ SINH VIÊN 5 TỐT`,
        studentName: data.studentName,
        openingParagraph: `Lời đầu tiên, ${organizationName} xin cảm ơn bạn đã quan tâm và tham gia xét chọn danh hiệu Sinh viên 5 tốt${data.schoolYear ? ` năm học ${data.schoolYear}` : ''}.`,
        mainAnnouncement: 'Hồ sơ Sinh viên 5 tốt của bạn đã được tiếp nhận',
        bodyBlocks: [
          buildInfoBlock('Thông tin hồ sơ:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Cấp xét đăng ký', data.targetLevel],
            ['Trạng thái', 'Đã nộp, đang chờ xét duyệt'],
          ]),
          'Trong thời gian xét duyệt, cán bộ phụ trách sẽ kiểm tra hồ sơ và minh chứng theo từng tiêu chí. Trường hợp hồ sơ cần bổ sung hoặc làm rõ thêm thông tin, bạn sẽ nhận được thông báo tiếp theo từ hệ thống 5TOT.',
        ],
        actionPrefix: 'Xem hồ sơ tại',
        actionLabel: data.applicationUrl,
        actionUrl: data.applicationUrl,
        note:
          'Bạn vui lòng thường xuyên theo dõi email và hệ thống 5TOT để cập nhật trạng thái hồ sơ.',
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
        logoUrl: data.logoUrl,
        showGoodDayWish: true,
      });
    }

    if (input.templateKey === 'application_resubmitted') {
      return renderOfficialEmailLayout({
        subject: `${subjectPrefix(data.schoolYear)} XÁC NHẬN TIẾP NHẬN PHẦN BỔ SUNG HỒ SƠ`,
        studentName: data.studentName,
        openingParagraph: `${organizationName} xin thông báo:`,
        mainAnnouncement: 'Phần bổ sung hồ sơ Sinh viên 5 tốt của bạn đã được tiếp nhận',
        bodyBlocks: [
          buildInfoBlock('Thông tin hồ sơ:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Tiêu chí đã bổ sung', data.criterionName],
            ['Trạng thái', 'Đã gửi lại, đang chờ cán bộ phụ trách kiểm tra'],
          ]),
          'Cán bộ phụ trách sẽ kiểm tra phần minh chứng bổ sung và cập nhật trạng thái hồ sơ trên hệ thống 5TOT.',
        ],
        actionPrefix: 'Theo dõi hồ sơ tại',
        actionLabel: data.applicationUrl,
        actionUrl: data.applicationUrl,
        note:
          'Bạn chưa cần thực hiện thêm thao tác nào ở thời điểm này, trừ khi có yêu cầu bổ sung mới từ cán bộ phụ trách.',
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
        logoUrl: data.logoUrl,
        showGoodDayWish: true,
      });
    }

    if (input.templateKey === 'supplement_requested') {
      if (data.context === 'reopened_by_manager') {
        return renderOfficialEmailLayout({
          subject: `${subjectPrefix(data.schoolYear)} HỒ SƠ ĐÃ ĐƯỢC MỞ ĐỂ BỔ SUNG MINH CHỨNG`,
          studentName: data.studentName,
          openingParagraph: `${organizationName} xin thông báo:`,
          mainAnnouncement: 'Hồ sơ Sinh viên 5 tốt của bạn đã được mở lại để bổ sung',
          bodyBlocks: [
            buildInfoBlock('Thông tin hồ sơ:', [
              ['Mã hồ sơ', data.applicationCode],
              ['Năm học', data.schoolYear],
              ['Tiêu chí cần bổ sung', data.criterionName],
              ['Thời hạn bổ sung', data.deadline],
            ]),
            `Nội dung yêu cầu:\n${data.supplementSummary}`,
            'Đề nghị bạn hoàn thành việc bổ sung minh chứng trên hệ thống 5TOT trước thời hạn nêu trên. Sau khi bạn gửi lại phần bổ sung, hồ sơ sẽ được chuyển đến cán bộ phụ trách để tiếp tục xét duyệt.',
          ],
          actionPrefix: 'Bổ sung hồ sơ tại',
          actionLabel: data.supplementUrl,
          actionUrl: data.supplementUrl,
          note:
            'Hồ sơ chỉ được tiếp tục xử lý sau khi bạn gửi lại phần bổ sung trên hệ thống.',
          supportEmail: data.supportEmail,
          websiteUrl: data.websiteUrl,
          logoUrl: data.logoUrl,
        });
      }

      return renderOfficialEmailLayout({
        subject: `${subjectPrefix(data.schoolYear)} YÊU CẦU BỔ SUNG MINH CHỨNG HỒ SƠ SINH VIÊN 5 TỐT`,
        studentName: data.studentName,
        openingParagraph: `${organizationName} xin thông báo:`,
        mainAnnouncement: 'Hồ sơ Sinh viên 5 tốt của bạn cần bổ sung/làm rõ minh chứng',
        bodyBlocks: [
          'Sau quá trình kiểm tra hồ sơ, cán bộ phụ trách ghi nhận hồ sơ của bạn cần bổ sung hoặc làm rõ thêm minh chứng cho tiêu chí sau:',
          buildInfoBlock('Thông tin yêu cầu:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Tiêu chí cần bổ sung', data.criterionName],
            ['Thời hạn bổ sung', data.deadline],
          ]),
          `Nội dung cần bổ sung:\n${data.supplementSummary}`,
          `Lý do yêu cầu bổ sung:\n${data.reason}`,
          'Đề nghị bạn đăng nhập hệ thống 5TOT và cập nhật minh chứng theo nội dung trên trước thời hạn để hồ sơ được tiếp tục xét duyệt.',
        ],
        actionPrefix: 'Bổ sung minh chứng tại',
        actionLabel: data.supplementUrl,
        actionUrl: data.supplementUrl,
        note:
          'Việc bổ sung đúng nội dung và đúng thời hạn sẽ giúp quá trình xét duyệt hồ sơ được thực hiện thuận lợi hơn.',
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
        logoUrl: data.logoUrl,
      });
    }

    if (input.templateKey === 'supplement_deadline_reminder') {
      const overdue = isOverdueReminder(data.reminderWindow);
      return renderOfficialEmailLayout({
        subject: overdue
          ? `${subjectPrefix(data.schoolYear)} HỒ SƠ ĐÃ QUÁ HẠN BỔ SUNG MINH CHỨNG`
          : `${subjectPrefix(data.schoolYear)} NHẮC HẠN BỔ SUNG HỒ SƠ SINH VIÊN 5 TỐT`,
        studentName: data.studentName,
        openingParagraph: overdue
          ? `${organizationName} xin thông báo:`
          : `${organizationName} xin nhắc bạn về yêu cầu bổ sung minh chứng cho hồ sơ Sinh viên 5 tốt.`,
        mainAnnouncement: overdue
          ? 'Hồ sơ Sinh viên 5 tốt của bạn đã quá hạn bổ sung minh chứng'
          : 'Nhắc hạn bổ sung minh chứng hồ sơ Sinh viên 5 tốt',
        bodyBlocks: overdue
          ? [
              buildInfoBlock('Thông tin yêu cầu:', [
                ['Mã hồ sơ', data.applicationCode],
                ['Năm học', data.schoolYear],
                ['Tiêu chí cần bổ sung', data.criterionName],
                ['Thời hạn bổ sung', data.deadline],
              ]),
              'Yêu cầu bổ sung minh chứng cho hồ sơ Sinh viên 5 tốt của bạn đã quá thời hạn. Vui lòng đăng nhập hệ thống 5TOT để kiểm tra trạng thái hồ sơ.',
              'Trường hợp hệ thống vẫn còn mở bổ sung, đề nghị bạn cập nhật minh chứng trong thời gian sớm nhất.',
            ]
          : [
              buildInfoBlock('Thông tin yêu cầu:', [
                ['Mã hồ sơ', data.applicationCode],
                ['Năm học', data.schoolYear],
                ['Tiêu chí cần bổ sung', data.criterionName],
                ['Thời hạn bổ sung', data.deadline],
              ]),
              `Nội dung cần bổ sung:\n${data.supplementSummary}`,
              'Đề nghị bạn hoàn thành việc bổ sung trước thời hạn để hồ sơ được tiếp tục xét duyệt.',
            ],
        actionPrefix: overdue ? 'Kiểm tra hồ sơ tại' : 'Bổ sung minh chứng tại',
        actionLabel: overdue ? data.applicationUrl : data.supplementUrl,
        actionUrl: overdue ? data.applicationUrl : data.supplementUrl,
        note: overdue
          ? 'Việc bổ sung sau thời hạn có thể ảnh hưởng đến quá trình xét duyệt hồ sơ theo kế hoạch của Hội Sinh viên Trường.'
          : 'Nếu quá thời hạn bổ sung, hồ sơ có thể bị ảnh hưởng trong quá trình xét duyệt theo kế hoạch của Hội Sinh viên Trường.',
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
        logoUrl: data.logoUrl,
      });
    }

    if (input.templateKey === 'application_rejected') {
      return renderOfficialEmailLayout({
        subject: `${subjectPrefix(data.schoolYear)} THÔNG BÁO CẬP NHẬT TRẠNG THÁI HỒ SƠ SINH VIÊN 5 TỐT`,
        studentName: data.studentName,
        openingParagraph: `${organizationName} xin thông báo:`,
        mainAnnouncement: 'Hồ sơ Sinh viên 5 tốt của bạn chưa đủ điều kiện ở đợt xét này',
        bodyBlocks: [
          `Sau quá trình xét duyệt, hồ sơ Sinh viên 5 tốt của bạn hiện chưa đủ điều kiện ở đợt xét${data.schoolYear ? ` năm học ${data.schoolYear}` : ' này'}.`,
          buildInfoBlock('Thông tin hồ sơ:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Trạng thái', 'Chưa đủ điều kiện'],
          ]),
          `Lý do chính:\n${data.reason}`,
          `Ghi chú từ cán bộ/Hội đồng xét duyệt:\n${data.reviewNote}`,
          'Bạn có thể xem chi tiết trạng thái từng tiêu chí và lịch sử xử lý hồ sơ trên hệ thống 5TOT.',
        ],
        actionPrefix: 'Xem chi tiết hồ sơ tại',
        actionLabel: data.applicationUrl,
        actionUrl: data.applicationUrl,
        note:
          'Kết quả trên được ghi nhận theo minh chứng và thông tin hồ sơ đã được nộp trên hệ thống trong đợt xét này.',
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
        logoUrl: data.logoUrl,
      });
    }

    if (input.templateKey === 'application_status_updated') {
      return renderOfficialEmailLayout({
        subject: `${subjectPrefix(data.schoolYear)} CẬP NHẬT TRẠNG THÁI HỒ SƠ SINH VIÊN 5 TỐT`,
        studentName: data.studentName,
        openingParagraph: `${organizationName} xin thông báo:`,
        mainAnnouncement: 'Cập nhật trạng thái hồ sơ Sinh viên 5 tốt',
        bodyBlocks: [
          buildInfoBlock('Thông tin hồ sơ:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Trạng thái hiện tại', data.statusLabel],
          ]),
          `Nội dung cập nhật:\n${data.statusMessage}`,
          'Bạn có thể xem chi tiết trạng thái hồ sơ trên hệ thống 5TOT.',
        ],
        actionPrefix: 'Xem hồ sơ tại',
        actionLabel: data.applicationUrl,
        actionUrl: data.applicationUrl,
        note:
          'Email này chỉ được sử dụng cho các cập nhật quan trọng liên quan trực tiếp đến hồ sơ của bạn.',
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
        logoUrl: data.logoUrl,
        showGoodDayWish: true,
      });
    }

    return renderResultTemplate(data);
  }
}

function renderResultTemplate(data: NormalizedMailPayload): RenderedMailTemplate {
  const achieved = isAchievedResult(data);
  return renderOfficialEmailLayout({
    subject: `${subjectPrefix(data.schoolYear)} THÔNG BÁO KẾT QUẢ XÉT DANH HIỆU SINH VIÊN 5 TỐT`,
    studentName: data.studentName,
    openingParagraph: `${organizationName} xin thông báo:`,
    mainAnnouncement: achieved
      ? 'Chúc mừng bạn đã đạt danh hiệu Sinh viên 5 tốt'
      : 'Thông báo kết quả xét danh hiệu Sinh viên 5 tốt',
    subAnnouncement: achieved ? data.finalLevel : undefined,
    bodyBlocks: achieved
      ? [
          'Sau quá trình xét duyệt, Hội đồng xét duyệt đã hoàn tất việc xem xét hồ sơ Sinh viên 5 tốt của bạn.',
          buildInfoBlock('Thông tin hồ sơ:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Kết quả', `Đạt danh hiệu Sinh viên 5 tốt ${data.finalLevel}`],
          ]),
          `Chúc mừng bạn đã đạt danh hiệu Sinh viên 5 tốt ${data.finalLevel}. Kết quả chi tiết đã được cập nhật trên hệ thống 5TOT.`,
        ]
      : [
          'Sau quá trình xét duyệt, Hội đồng xét duyệt đã hoàn tất việc xem xét hồ sơ Sinh viên 5 tốt của bạn.',
          buildInfoBlock('Thông tin hồ sơ:', [
            ['Mã hồ sơ', data.applicationCode],
            ['Năm học', data.schoolYear],
            ['Kết quả', 'Chưa đạt danh hiệu Sinh viên 5 tốt ở đợt xét này'],
          ]),
          `Lý do chính:\n${data.reason}`,
          `Ghi chú từ Hội đồng xét duyệt:\n${data.finalNote}`,
          'Bạn có thể xem chi tiết trạng thái từng tiêu chí và lịch sử xử lý hồ sơ trên hệ thống 5TOT.',
        ],
    actionPrefix: 'Xem kết quả tại',
    actionLabel: data.resultUrl,
    actionUrl: data.resultUrl,
    note: achieved
      ? 'Thông tin chính thức về giấy chứng nhận, khen thưởng hoặc các bước tiếp theo sẽ được Hội Sinh viên Trường thông báo theo kế hoạch, nếu có.'
      : `Kết quả trên được ghi nhận theo minh chứng và thông tin hồ sơ đã được nộp trên hệ thống trong đợt xét${data.schoolYear ? ` năm học ${data.schoolYear}` : ' này'}.`,
    extraClosingSentence: achieved
      ? 'Một lần nữa, xin chúc mừng bạn và cảm ơn bạn đã tham gia phong trào Sinh viên 5 tốt.'
      : undefined,
    supportEmail: data.supportEmail,
    websiteUrl: data.websiteUrl,
    logoUrl: data.logoUrl,
    showGoodDayWish: !achieved,
  });
}

function renderOfficialEmailLayout(input: OfficialEmailLayoutInput): RenderedMailTemplate {
  const textParts = [
    `Thân chào bạn ${input.studentName},`,
    input.openingParagraph,
    `${organizationName} xin thông báo:`,
    input.mainAnnouncement.toUpperCase(),
    input.subAnnouncement?.toUpperCase(),
    ...input.bodyBlocks,
    input.actionUrl && input.actionLabel
      ? `${input.actionPrefix ?? 'Xem chi tiết tại'}: ${input.actionLabel}`
      : undefined,
    input.note ? `Lưu ý: ${input.note}` : undefined,
    commonSupportSentence,
    input.extraClosingSentence,
    input.showGoodDayWish ? 'Chúc bạn một ngày tốt lành!' : undefined,
    'Trân trọng,',
    '',
    organizationNameUpper,
    systemName,
    input.supportEmail ? `Email hỗ trợ: ${input.supportEmail}` : undefined,
    input.websiteUrl ? `Website: ${input.websiteUrl}` : undefined,
  ].filter((part): part is string => Boolean(part));
  const text = textParts.join('\n\n');

  const html = [
    '<!doctype html>',
    '<html>',
    '<body style="margin:0; padding:0; background:#ffffff;">',
    '<div style="font-family:\'Times New Roman\', Arial, sans-serif; font-size:15px; line-height:1.6; color:#111111; max-width:760px; background:#ffffff; padding:24px;">',
    `<p>Thân chào bạn <strong>${escapeHtml(input.studentName)}</strong>,</p>`,
    `<p>${escapeHtml(input.openingParagraph)}</p>`,
    `<p><strong style="color:#d93025;">${escapeHtml(organizationName)}</strong> xin thông báo:</p>`,
    '<div style="text-align:center; margin:18px 0;">',
    `<div style="font-weight:bold; color:#0b57d0; text-transform:uppercase;">${escapeHtml(input.mainAnnouncement)}</div>`,
    input.subAnnouncement
      ? `<div style="font-weight:bold; color:#0b57d0; text-transform:uppercase;">${escapeHtml(input.subAnnouncement)}</div>`
      : '',
    '</div>',
    ...input.bodyBlocks.map(renderHtmlBlock),
    input.actionUrl && input.actionLabel
      ? `<p>${escapeHtml(input.actionPrefix ?? 'Xem chi tiết tại')}: <a href="${escapeHtmlAttribute(input.actionUrl)}" style="color:#1155cc; font-weight:bold; text-decoration:underline;">${escapeHtml(input.actionLabel)}</a></p>`
      : '',
    input.note ? `<p><strong>Lưu ý:</strong> <em>${escapeHtml(input.note)}</em></p>` : '',
    `<p>${escapeHtml(commonSupportSentence)}</p>`,
    input.extraClosingSentence ? `<p>${escapeHtml(input.extraClosingSentence)}</p>` : '',
    input.showGoodDayWish ? '<p>Chúc bạn một ngày tốt lành!</p>' : '',
    '<p>Trân trọng,</p>',
    '<div style="margin-top:20px; border-top:1px solid #333333; padding-top:12px;">',
    input.logoUrl
      ? `<img src="${escapeHtmlAttribute(input.logoUrl)}" alt="5TOT" style="max-width:120px; height:auto; margin-bottom:8px;" />`
      : '',
    `<div style="font-weight:bold; color:#d93025; text-transform:uppercase;">${escapeHtml(organizationNameUpper)}</div>`,
    `<div><strong>Hệ thống:</strong> ${escapeHtml(systemName.replace('Hệ thống ', ''))}</div>`,
    input.supportEmail
      ? `<div><strong>Email hỗ trợ:</strong> ${escapeHtml(input.supportEmail)}</div>`
      : '',
    input.websiteUrl
      ? `<div><strong>Website:</strong> <a href="${escapeHtmlAttribute(input.websiteUrl)}" style="color:#1155cc;">${escapeHtml(input.websiteUrl)}</a></div>`
      : '',
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  return {
    subject: sanitizeRendered(input.subject),
    text: sanitizeRendered(text),
    html: sanitizeRendered(html),
  };
}

function renderHtmlBlock(block: string): string {
  if (block.includes('\n- ')) {
    const [title, ...items] = block.split('\n');
    return [
      `<p><strong>${escapeHtml(title.replace(/:$/, ''))}:</strong></p>`,
      '<ul style="margin-top:0; padding-left:22px;">',
      ...items.map((item) => `<li>${escapeHtml(item.replace(/^- /, ''))}</li>`),
      '</ul>',
    ].join('');
  }
  return `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`;
}

function normalizePayload(payload: Record<string, unknown>): NormalizedMailPayload {
  const applicationId = firstString(payload.applicationId, payload.applicationCode);
  const applicationUrl = firstString(payload.applicationUrl) ?? buildAppLink(applicationId);
  const supplementUrl = firstString(payload.supplementUrl) ?? applicationUrl;
  const resultUrl = firstString(payload.resultUrl) ?? applicationUrl;
  const schoolYear = firstString(payload.schoolYear);
  const targetLevel = levelLabelFor(firstString(payload.targetLevel));
  const finalLevel = levelLabelFor(firstString(payload.finalLevel));
  const finalStatus = firstString(payload.finalStatus);

  return {
    studentName: firstString(payload.studentName, payload.recipientName) ?? 'bạn',
    applicationCode: applicationId ?? 'Chưa có',
    schoolYear,
    targetLevel: targetLevel ?? defaultTargetLevel,
    finalLevel: finalLevel ?? defaultTargetLevel,
    criterionName:
      criterionLabelFor(firstString(payload.criterionName, payload.criterion)) ??
      defaultCriterionName,
    supplementSummary:
      firstString(payload.supplementSummary, payload.requestedFields, payload.reason) ??
      defaultSupplementSummary,
    reason: firstString(payload.reason, payload.context) ?? defaultDetailMessage,
    reviewNote: firstString(payload.reviewNote, payload.context) ?? defaultDetailMessage,
    finalNote: firstString(payload.finalNote, payload.reason) ?? defaultDetailMessage,
    deadline: formatDeadline(firstString(payload.deadline)),
    statusLabel: statusLabelFor(firstString(payload.statusLabel, payload.status)),
    statusMessage: firstString(payload.statusMessage, payload.context) ?? defaultDetailMessage,
    applicationUrl,
    supplementUrl,
    resultUrl,
    supportEmail: firstString(payload.supportEmail) ?? env.MAIL_FROM_ADDRESS,
    websiteUrl: firstString(payload.websiteUrl) ?? env.APP_BASE_URL,
    logoUrl: firstString(payload.logoUrl),
    finalStatus,
    reminderWindow: firstString(payload.reminderWindow, payload.window),
    context: firstString(payload.contextType, payload.context),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      const text = value
        .map((item) => firstString(item))
        .filter((item): item is string => Boolean(item))
        .join(', ');
      if (text) return text;
      continue;
    }
    const text = String(value).trim();
    if (text && text !== 'undefined' && text !== 'null' && text !== 'NaN') return text;
  }
  return undefined;
}

function buildInfoBlock(title: string, rows: Array<[string, string | undefined]>): string {
  const visibleRows = rows.filter(([, value]) => Boolean(value));
  if (!visibleRows.length) return '';
  return [title, ...visibleRows.map(([label, value]) => `- ${label}: ${value}`)].join('\n');
}

function buildAppLink(applicationId?: string): string {
  const base = env.APP_BASE_URL.replace(/\/$/, '');
  if (!applicationId) return `${base}/app`;
  return `${base}/app?applicationId=${encodeURIComponent(applicationId)}`;
}

function subjectPrefix(schoolYear?: string): string {
  return schoolYear ? `[5TOT.${schoolYear}]` : '[5TOT]';
}

function levelLabelFor(value?: string): string | undefined {
  if (!value) return undefined;
  const labels: Record<string, string> = {
    school: 'cấp Trường',
    university: 'cấp Đại học Đà Nẵng',
    city: 'cấp Thành phố',
    central: 'cấp Trung ương',
  };
  return mapCsvLabel(value, labels);
}

function statusLabelFor(value?: string): string {
  if (!value) return defaultDetailMessage;
  const labels: Record<string, string> = {
    under_review: 'Đang chờ xét duyệt',
    supplement_required: 'Cần bổ sung minh chứng',
    draft_supplement: 'Đang bổ sung minh chứng',
    completed: 'Đã hoàn tất xét duyệt',
    rejected: 'Chưa đủ điều kiện',
    submitted: 'Đã nộp hồ sơ',
    ready_to_submit: 'Sẵn sàng nộp',
    draft: 'Bản nháp',
    prechecked: 'Đã tiền kiểm',
    resolution_needed: 'Đang được xác minh thêm',
  };
  return labels[value] ?? value;
}

function criterionLabelFor(value?: string): string | undefined {
  if (!value) return undefined;
  const labels: Record<string, string> = {
    ethics: 'Đạo đức tốt',
    academic: 'Học tập tốt',
    physical: 'Thể lực tốt',
    volunteer: 'Tình nguyện tốt',
    integration: 'Hội nhập tốt',
    priority: 'Tiêu chí ưu tiên',
    collective: 'Tập thể Sinh viên 5 tốt',
  };
  return mapCsvLabel(value, labels);
}

function mapCsvLabel(value: string, labels: Record<string, string>): string {
  return value
    .split(',')
    .map((item) => {
      const key = item.trim();
      return labels[key] ?? key;
    })
    .filter(Boolean)
    .join(', ');
}

function formatDeadline(value?: string): string {
  if (!value) return defaultDeadline;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function isAchievedResult(data: NormalizedMailPayload): boolean {
  if (data.finalStatus === 'failed') return false;
  if (data.finalStatus === 'passed' || data.finalStatus === 'partially_passed') {
    return true;
  }
  return data.finalLevel !== defaultTargetLevel && !data.statusLabel.toLowerCase().includes('chưa');
}

function isOverdueReminder(value?: string): boolean {
  return value?.toUpperCase() === 'OVERDUE' || value === 'overdue';
}

function sanitizeRendered(value: string): string {
  return value.replace(/\b(undefined|null|NaN)\b/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
