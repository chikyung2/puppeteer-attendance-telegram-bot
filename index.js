import dotenv from 'dotenv'
dotenv.config()
import moment from 'moment'
import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import pptr from 'puppeteer'
import pptrCore from 'puppeteer-core'
import chromium from 'chrome-aws-lambda'
import cron from 'node-cron'

let chrome = {}
let puppeteer

if (process.env.AWS_LAMBDA_FUNCTION_VERSION) {
  // running on the Vercel platform.
  chrome = chromium
  puppeteer = pptrCore
} else {
  // running locally.
  puppeteer = pptr
}

const takeAttendance = async (classInfo) => {
  // Launch puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: false,
    // Sometimes not work, then set a slowMo
    // slowMo: 100,
  })
  // Grant permissions for the page to read its geolocation.
  const context = browser.defaultBrowserContext()
  await context.overridePermissions(process.env.OLE_BASE_URL, ['geolocation'])

  const page = await browser.newPage()
  // Sets the page's geolocation
  await page.setGeolocation({
    latitude: parseFloat(process.env.HKMU_LATITUDE),
    longitude: parseFloat(process.env.HKMU_LONGITUDE),
  })
  // await page.goto(process.env.OLE_LOGIN_URL)
  await page.goto(
    `${process.env.OLE_ATTENDANCE_URL}/${classInfo.courseCode}.nsf//class_activities_student?readform&`
  )
  // url will change auto like: 'https://ole.hkmu.edu.hk/names.nsf?Login&RedirectTo=https://ole.hkmu.edu.hk/course2300/comps351f.nsf//class_activities_student?readform&'
  // will change to 'https://ole.hkmu.edu.hk/names.nsf?Login&RedirectTo=https://ole.hkmu.edu.hk/course2300/comps351f.nsf//class_activities_student?readform&26'
  await page.waitForNavigation()

  // Input username and password
  const input_username = await page.$x(
    '/html/body/form/div[1]/table/tbody/tr[2]/td[2]/input[1]'
  )
  await input_username[0].type(process.env.HKMU_USERNAME)
  const input_password = await page.$x(
    '/html/body/form/div[1]/table/tbody/tr[2]/td[2]/input[2]'
  )
  await input_password[0].type(process.env.HKMU_PASSWORD)

  const button_enter = await page.$x(
    '/html/body/form/div[1]/table/tbody/tr[2]/td[2]/a'
  )
  await button_enter[0].click()
  await page.waitForNavigation()

  // Old Method: Go to specific course page and take attendance
  // await page.goto(
  //   `${process.env.OLE_COURSE_URL}/${classInfo.courseCode}.nsf//class_activities_student?readform&`
  // )

  // Get current time
  const date = moment()
  const formattedDate = date.format('YYYY-MM-DD-HH-mm-ss')

  // Take screenshot
  const filename = `${classInfo.courseCode}-${formattedDate}.png`
  await page.screenshot({
    path: `./screenshots/${filename}`,
  })

  // Check if attendance success
  const isSubmitted = await page.$('#submitted_msg')
  await reportAttendance(isSubmitted, filename, date, classInfo)
  
  await browser.close()
}

const reportAttendance = async (isSubmitted, filename, date, classInfo) => {
  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })
  const dateOfClass = date.format('YYYY/MM/DD') + ' ' + classInfo.time

  if (isSubmitted) {
    bot.sendPhoto(process.env.TELEGRAM_CHAT_ID, `./screenshots/${filename}`, {
      caption: `Take Attendance Successfully !!!\nCourse Code: ${classInfo.courseCode}\nDate of Class: ${dateOfClass} 14:00\nSubmission Time: ${date}`,
    })
  } else {
    bot.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      `Fail to Take Attendance !!!\nCourse Code: ${classInfo.courseCode}\nDate of Class: ${dateOfClass}\nSubmission Time: ${date}`
    )
  }
}

const checkAttendance = () => {
  const classes = JSON.parse(fs.readFileSync('./schedule.json', 'utf-8'))
  const currentTime = moment()

  for (const classInfo of classes) {
    const classTime = moment(
      `${classInfo.weekday} ${classInfo.time}`,
      'dddd hh:mm A'
    )
    if (currentTime.isBetween(classTime, moment(classTime).add(2, 'hour'))) {
      console.log('Now Take Attendance: ', classInfo.courseCode)
      takeAttendance(classInfo)
    }
  }
}

cron.schedule('0 * * * *', () => {
  checkAttendance()
})
