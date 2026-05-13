// Cloudflare Pages Function - 酒店OTA计算器表单提交接口
// 支持：企业微信群机器人通知 + 飞书多维表格存储

// 环境变量（在 Cloudflare Dashboard 中配置）：
// WECOM_WEBHOOK_URL - 企业微信群机器人 Webhook 地址
// FEISHU_APP_ID - 飞书应用 App ID
// FEISHU_APP_SECRET - 飞书应用 App Secret
// FEISHU_BITABLE_APP_TOKEN - 飞书多维表格 App Token
// FEISHU_BITABLE_TABLE_ID - 飞书多维表格 Table ID

export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const { phone, hotelName, wechat, rooms, price, occupancy, otaRatio, totalCommission, potentialSavings } = data;

    // 验证必填字段
    if (!phone || phone.length < 11) {
      return new Response(JSON.stringify({ success: false, message: '请输入正确的手机号' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 构建提交记录
    const record = {
      phone,
      hotelName: hotelName || '未填写',
      wechat: wechat || '未填写',
      rooms: rooms || '未填写',
      price: price || '未填写',
      occupancy: occupancy || '未填写',
      otaRatio: otaRatio || '未填写',
      totalCommission: totalCommission || '未填写',
      potentialSavings: potentialSavings || '未填写',
      submittedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      ip: context.request.headers.get('CF-Connecting-IP') || 'unknown'
    };

    const results = {};

    // 1. 发送企业微信通知
    if (context.env.WECOM_WEBHOOK_URL) {
      try {
        const wecomResult = await sendWeComNotification(context.env.WECOM_WEBHOOK_URL, record);
        results.wecom = wecomResult ? 'sent' : 'failed';
      } catch (e) {
        results.wecom = 'error: ' + e.message;
      }
    } else {
      results.wecom = 'not_configured';
    }

    // 2. 写入飞书多维表格
    if (context.env.FEISHU_APP_ID && context.env.FEISHU_APP_SECRET && context.env.FEISHU_BITABLE_APP_TOKEN) {
      try {
        const feishuResult = await saveToFeishuBitable(context.env, record);
        results.feishu = feishuResult ? 'saved' : 'failed';
      } catch (e) {
        results.feishu = 'error: ' + e.message;
      }
    } else {
      results.feishu = 'not_configured';
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ========== 企业微信群机器人通知 ==========
async function sendWeComNotification(webhookUrl, record) {
  const message = {
    msgtype: 'markdown',
    markdown: {
      content: `## 🏨 新客户咨询\n` +
        `> **酒店名称**：${record.hotelName}\n` +
        `> **手机号**：<font color="info">${record.phone}</font>\n` +
        `> **微信号**：${record.wechat}\n` +
        `> **房间数**：${record.rooms} 间\n` +
        `> **均价**：¥${record.price}/晚\n` +
        `> **入住率**：${record.occupancy}\n` +
        `> **OTA占比**：${record.otaRatio}\n` +
        `> **年OTA佣金**：<font color="warning">${record.totalCommission}</font>\n` +
        `> **可节省**：<font color="comment">${record.potentialSavings}</font>\n` +
        `> **提交时间**：${record.submittedAt}\n` +
        `> **IP**：${record.ip}\n\n` +
        `请尽快联系客户！📞`
    }
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  const result = await response.json();
  return result.errcode === 0;
}

// ========== 飞书多维表格存储 ==========
async function saveToFeishuBitable(env, record) {
  // 1. 获取飞书 access_token
  const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET
    })
  });

  const tokenData = await tokenResponse.json();
  if (tokenData.code !== 0) {
    throw new Error('Feishu auth failed: ' + tokenData.msg);
  }

  const accessToken = tokenData.tenant_access_token;

  // 2. 写入多维表格
  const tableId = env.FEISHU_BITABLE_TABLE_ID;
  const appToken = env.FEISHU_BITABLE_APP_TOKEN;

  const addResponse = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          '手机号': record.phone,
          '酒店名称': record.hotelName,
          '微信号': record.wechat,
          '房间数': parseInt(record.rooms) || 0,
          '均价': parseInt(record.price) || 0,
          '入住率': record.occupancy,
          'OTA占比': record.otaRatio,
          '年OTA佣金': record.totalCommission,
          '可节省': record.potentialSavings,
          '提交时间': record.submittedAt,
          'IP': record.ip
        }
      })
    }
  );

  const addResult = await addResponse.json();
  return addResult.code === 0;
}
